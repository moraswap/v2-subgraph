/* eslint-disable prefer-const */
import { Pair, Token, Bundle } from '../types/schema'
import { BigDecimal, Address, BigInt } from '@graphprotocol/graph-ts/index'
import { ZERO_BD, factoryContract, ONE_BD, UNTRACKED_PAIRS } from './helpers'
import { ADDRESS_ZERO, DAI_ADDRESS, DAI_WSOL_PAIR, USDC_ADDRESS, USDC_WSOL_PAIR, USDT_ADDRESS, USDT_WSOL_PAIR, WBTC_ADDRESS, WETH9_ADDRESS, WSOL_ADDRESS } from '../constants'

export function getSolPriceInUSD(): BigDecimal {
  // fetch sol prices for each stablecoin
  let usdcPair = Pair.load(USDC_WSOL_PAIR) // usdc is token0
  let usdtPair = Pair.load(USDT_WSOL_PAIR) // usdt is token1
  // let daiPair = Pair.load(DAI_WSOL_PAIR) // dai is token0

  // all 3 have been created
  if (usdcPair !== null && usdtPair !== null
      // && daiPair !== null
    ) {
    let totalLiquiditySOL = usdcPair.reserve0
                              .plus(usdtPair.reserve1)
                              // .plus(daiPair.reserve1)
    let usdcWeight = usdcPair.reserve0.div(totalLiquiditySOL)
    let usdtWeight = usdtPair.reserve1.div(totalLiquiditySOL)
    // let daiWeight = daiPair.reserve1.div(totalLiquiditySOL)
    return usdcPair.token1Price.times(usdcWeight)
      .plus(usdtPair.token0Price.times(usdtWeight))
      // .plus(daiPair.token1Price.times(daiWeight))
  }
  // USDT and USDT have been created
  else if (usdtPair !== null && usdcPair !== null) {
    let totalLiquiditySOL = usdcPair.reserve0
                              .plus(usdtPair.reserve1)
    let usdcWeight = usdcPair.reserve0.div(totalLiquiditySOL)
    let usdtWeight = usdtPair.reserve1.div(totalLiquiditySOL)
    return usdcPair.token1Price.times(usdcWeight)
      .plus(usdtPair.token0Price.times(usdtWeight))
  }
  else if (usdtPair !== null) {
    return usdtPair.token0Price
  } else {
    return ZERO_BD
  }
}

// token where amounts should contribute to tracked volume and liquidity
let WHITELIST: string[] = [
  WSOL_ADDRESS, // WSOL
  WETH9_ADDRESS, // WETH9
  // DAI_ADDRESS, // DAI
  USDC_ADDRESS, // USDC
  USDT_ADDRESS, // USDT
  // WBTC_ADDRESS, // WBTC
]

// minimum liquidity required to count towards tracked volume for pairs with small # of Lps
let MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('400000')

// minimum liquidity for price to get tracked
let MINIMUM_LIQUIDITY_THRESHOLD_SOL = BigDecimal.fromString('2')

/**
 * Search through graph to find derived Sol per token.
 * @todo update to be derived SOL (add stablecoin estimates)
 **/
export function findSolPerToken(token: Token): BigDecimal {
  if (token.id == WSOL_ADDRESS) {
    return ONE_BD
  }
  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairAddress = factoryContract.getPair(Address.fromString(token.id), Address.fromString(WHITELIST[i]))
    if (pairAddress.toHexString() != ADDRESS_ZERO) {
      let pair = Pair.load(pairAddress.toHexString())
      if (pair.token0 == token.id && pair.reserveSOL.gt(MINIMUM_LIQUIDITY_THRESHOLD_SOL)) {
        let token1 = Token.load(pair.token1)
        return pair.token1Price.times(token1.derivedSOL as BigDecimal) // return token1 per our token * Sol per token 1
      }
      if (pair.token1 == token.id && pair.reserveSOL.gt(MINIMUM_LIQUIDITY_THRESHOLD_SOL)) {
        let token0 = Token.load(pair.token0)
        return pair.token0Price.times(token0.derivedSOL as BigDecimal) // return token0 per our token * SOL per token 0
      }
    }
  }
  return ZERO_BD // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load('1')
  // let derivedSOL0 = token0.derivedSOL || ZERO_BD
  // let derivedSOL1 = token1.derivedSOL || ZERO_BD
  let price0 = token0.derivedSOL.times(bundle.solPrice)
  let price1 = token1.derivedSOL.times(bundle.solPrice)

  // dont count tracked volume on these pairs - usually rebass tokens
  if (UNTRACKED_PAIRS.includes(pair.id)) {
    return ZERO_BD
  }

  // if less than 5 LPs, require high minimum reserve amount amount or return 0
  if (pair.liquidityProviderCount.lt(BigInt.fromI32(5))) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)
    if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
  }

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0
      .times(price0)
      .plus(tokenAmount1.times(price1))
      .div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load('1')
  // let derivedSOL0 = token0.derivedSOL || ZERO_BD
  // let derivedSOL1 = token1.derivedSOL || ZERO_BD
  let price0 = token0.derivedSOL.times(bundle.solPrice)
  let price1 = token1.derivedSOL.times(bundle.solPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id) && !WHITELIST.includes(token1.id)) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id) && WHITELIST.includes(token1.id)) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
