import { ClarityType, contractPrincipalCV, cvToString, uintCV } from 'micro-stacks/clarity';
import { pubscriptCVToBtcAddress } from './btcTransactions';
import { getFTData, getNFTData } from './tokenData';
import { optionalCVToString } from './transactions';
import { ftFeeContracts, NETWORK, nftFeeContracts } from './constants';
import { callReadOnlyFunction, fetchNamesByAddress } from 'micro-stacks/api';
import { fetchPrivate } from 'micro-stacks/common';

/**
 *
 * @param  assetString identifier in the form address.name::assetName
 * @returns contract as CV and asset name
 */
export function splitAssetIdentifier(assetString) {
  const [contractAddress, tail] = assetString.split('.');
  const [contractName, assetName] = tail.split('::');
  const contractCV = contractPrincipalCV(contractAddress, contractName);
  return [contractCV, assetName, contractName, contractAddress];
}

export function isAtomic(type) {
  return type.indexOf('-') > 0;
}

export function buyAssetFromType(type) {
  return type.startsWith('stx-') //
    ? 'STX'
    : type.startsWith('banana-')
    ? 'BANANA'
    : type.startsWith('usda-')
    ? 'USDA'
    : type.startsWith('xbtc-')
    ? 'xBTC'
    : type.startsWith('satoshible-')
    ? 'SATOSHIBLE'
    : 'BTC';
}

export function buyAssetTypeFromSwapType(type) {
  return isAtomic(type) ? type.split('-')[0] : 'btc';
}

export function buyDecimalsFromType(type) {
  return type.startsWith('stx-') //
    ? 6
    : type.startsWith('banana-')
    ? 6
    : type.startsWith('usda-')
    ? 6
    : type.startsWith('xbtc-')
    ? 8
    : 8;
}

export function factorForType(type) {
  return type.startsWith('stx-') //
    ? 1_000_000
    : type.startsWith('banana-')
    ? 1_000_000
    : type.startsWith('usda-')
    ? 1_000_000
    : type.startsWith('xbtc-')
    ? 100_000_000
    : 100_000_000;
}
export function amountFromSwapsEntry(swapsEntry, type) {
  const factor = factorForType(type);
  let amountProperty = type.startsWith('stx-')
    ? 'ustx'
    : type.startsWith('banana-')
    ? 'ubanana'
    : type.startsWith('usda-')
    ? 'ustx'
    : type.startsWith('xbtc-')
    ? 'ustx'
    : 'sats';
  return swapsEntry.data[amountProperty] / factor;
}

export async function setFromDataFromSwapsEntry(swapsEntry, type, setFormData) {
  const whenFromSwap = swapsEntry.data['when'].value;
  const doneFromSwap = swapsEntry.data['done']
    ? swapsEntry.data['done'].value
    : swapsEntry.data['open'].type === ClarityType.BoolTrue
    ? 0
    : 1;
  const btcRecipient = isAtomic(type)
    ? undefined
    : pubscriptCVToBtcAddress(swapsEntry.data['btc-receiver']);
  const amountBtcOrStx = amountFromSwapsEntry(swapsEntry, type);
  let trait, ftData, nftData, contractAddress, contractName;
  let feeAddress, feeName, feeId;
  switch (type) {
    case 'ft':
      trait = cvToString(swapsEntry.data['ft']);
      [contractAddress, contractName] = trait.split('.');
      ftData = await getFTData(contractAddress, contractName);

      setFormData({
        btcRecipient,
        amountSats: amountBtcOrStx,
        trait: trait + '::' + ftData.assetName,
        amount: swapsEntry.data.amount.value / Math.pow(10, ftData.decimals),
        assetRecipient: optionalCVToString(swapsEntry.data['ft-receiver']),
        assetRecipientFromSwap: optionalCVToString(swapsEntry.data['ft-receiver']),
        assetSenderFromSwap: cvToString(swapsEntry.data['ft-sender']),
        whenFromSwap,
        doneFromSwap,
      });
      break;
    case 'stx':
      setFormData({
        btcRecipient,
        amountSats: amountBtcOrStx,
        amount: swapsEntry.data.ustx.value / Math.pow(10, 6),
        assetRecipient: optionalCVToString(swapsEntry.data['stx-receiver']),
        assetRecipientFromSwap: optionalCVToString(swapsEntry.data['stx-receiver']),
        assetSenderFromSwap: cvToString(swapsEntry.data['stx-sender']),
        whenFromSwap,
        doneFromSwap,
      });
      break;
    case 'nft':
      trait = cvToString(swapsEntry.data['nft']);
      nftData = await getNFTData(trait);

      setFormData({
        btcRecipient,
        amountSats: amountBtcOrStx,
        trait: trait + '::' + nftData.assetName,
        nftId: swapsEntry.data['nft-id'].value,
        assetRecipient: cvToString(swapsEntry.data['nft-receiver']),
        assetRecipientFromSwap: cvToString(swapsEntry.data['nft-receiver']),
        assetSenderFromSwap: cvToString(swapsEntry.data['nft-sender']),
        whenFromSwap,
        doneFromSwap,
      });
      break;
    case 'stx-ft':
      trait = cvToString(swapsEntry.data['ft']);
      [feeAddress, feeName] = cvToString(swapsEntry.data['fees']).split('.');
      feeId = Object.entries(ftFeeContracts).find(
        e => e[1].address === feeAddress && e[1].name === feeName
      );
      [contractAddress, contractName] = trait.split('.');
      ftData = await getFTData(contractAddress, contractName);
      setFormData({
        btcRecipient,
        amountSats: amountBtcOrStx,
        trait: trait + '::' + ftData.assetName,
        amount: swapsEntry.data.amount.value / Math.pow(10, ftData.decimals),
        assetRecipient: cvToString(swapsEntry.data['stx-sender']),
        assetRecipientFromSwap: cvToString(swapsEntry.data['stx-sender']),
        assetSenderFromSwap: cvToString(swapsEntry.data['ft-sender']),
        whenFromSwap,
        doneFromSwap,
        feeId: feeId ? feeId[0] : 'stx', // TODO better fall back
      });
      break;
    case 'stx-nft':
      trait = cvToString(swapsEntry.data['nft']);
      [feeAddress, feeName] = cvToString(swapsEntry.data['fees']).split('.');
      feeId = Object.entries(nftFeeContracts).find(
        e => e[1].address === feeAddress && e[1].name === feeName
      );
      [contractAddress, contractName] = trait.split('.');
      nftData = await getNFTData(contractAddress, contractName);
      setFormData({
        btcRecipient,
        amountSats: amountBtcOrStx,
        trait: trait + '::' + nftData.assetName,
        nftId: swapsEntry.data['nft-id'].value,
        assetRecipient: cvToString(swapsEntry.data['stx-sender']),
        assetRecipientFromSwap: cvToString(swapsEntry.data['stx-sender']),
        assetSenderFromSwap: cvToString(swapsEntry.data['nft-sender']),
        whenFromSwap,
        doneFromSwap,
        feeId: feeId ? feeId[0] : 'stx', // TODO better fall back
      });
      break;
    default:
      console.log('unsupported type ' + type);
  }
}

export async function resolveImageForNFT(contractAddress, contractName, nftId) {
  const tokenUriCV = await callReadOnlyFunction({
    contractAddress,
    contractName,
    functionName: 'get-token-uri',
    functionArgs: [uintCV(nftId)],
  });
  console.log({ tokenUriCV: tokenUriCV.value.value });
  const nftUrl =
    tokenUriCV.type === ClarityType.ResponseOk && tokenUriCV.value.type === ClarityType.OptionalSome
      ? tokenUriCV.value.value.data
      : undefined;
  console.log(nftUrl);
  if (nftUrl) {
    let url = nftUrl.replace('{id}', nftId);
    console.log(url);
    url = url.replace('ipfs://', 'https://gateway.pinata.cloud/ipfs/');
    const metaDataResponse = await fetchPrivate(url);
    console.log(metaDataResponse);
    const metaData = await metaDataResponse.json();
    console.log({ metaData });
    let image = metaData.image || metaData.properties.image;
    console.log(image);
    image = image.replace('ipfs://', 'https://gateway.pinata.cloud/ipfs/');
    console.log(image);
    return image;
  } else {
    return undefined;
  }
}

export async function resolveOwnerForNFT(contractAddress, contractName, nftId) {
  const ownerCV = await callReadOnlyFunction({
    contractAddress,
    contractName,
    functionName: 'get-owner',
    functionArgs: [uintCV(nftId)],
  });
  const owner =
    ownerCV.type === ClarityType.ResponseOk && ownerCV.value.type === ClarityType.OptionalSome
      ? cvToString(ownerCV.value.value)
      : undefined;
  console.log(owner);
  const namesResponse = await fetchNamesByAddress({
    url: NETWORK.bnsLookupUrl,
    address: owner,
    blockchain: 'stacks',
  });
  return namesResponse.names?.length ? namesResponse.names[0] : owner;
}
