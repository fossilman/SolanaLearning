//! Constant product AMM curve math (x * y = k)
//! Based on constant-product-curve formulas, no_std compatible

#[derive(Debug)]
pub enum CurveError {
    Overflow,
    Underflow,
    ZeroBalance,
    SlippageExceeded,
}

const PRECISION: u32 = 1_000_000;

/// Calculate amount of Y to withdraw when depositing X (swap X for Y)
/// delta_y = y - k/(x + amount_in)
/// Amount after fee: amount_in * (10000 - fee_bps) / 10000
pub fn delta_y_from_x_swap(x: u64, y: u64, amount_in: u64, fee_bps: u16) -> Result<u64, CurveError> {
    if x == 0 || y == 0 {
        return Err(CurveError::ZeroBalance);
    }
    let amount_after_fee = (amount_in as u128)
        .checked_mul((10_000 - fee_bps) as u128)
        .ok_or(CurveError::Overflow)?
        .checked_div(10_000)
        .ok_or(CurveError::Overflow)? as u64;

    let k = (x as u128).checked_mul(y as u128).ok_or(CurveError::Overflow)?;
    let x_new = (x as u128)
        .checked_add(amount_after_fee as u128)
        .ok_or(CurveError::Overflow)?;
    let y_new = k.checked_div(x_new).ok_or(CurveError::Overflow)? as u64;
    let delta_y = y.checked_sub(y_new).ok_or(CurveError::Underflow)?;
    Ok(delta_y)
}

/// Calculate amount of X to withdraw when depositing Y (swap Y for X)
pub fn delta_x_from_y_swap(x: u64, y: u64, amount_in: u64, fee_bps: u16) -> Result<u64, CurveError> {
    delta_y_from_x_swap(y, x, amount_in, fee_bps)
}

/// Calculate amounts of X and Y to deposit for minting `lp_amount` LP tokens
/// ratio = (l + lp_amount) / l
/// deposit_x = x * (ratio - 1), deposit_y = y * (ratio - 1)
pub fn xy_deposit_amounts(x: u64, y: u64, l: u64, lp_amount: u64) -> Result<(u64, u64), CurveError> {
    if l == 0 {
        return Err(CurveError::ZeroBalance);
    }
    let ratio = (l as u128)
        .checked_add(lp_amount as u128)
        .ok_or(CurveError::Overflow)?
        .checked_mul(PRECISION as u128)
        .ok_or(CurveError::Overflow)?
        .checked_div(l as u128)
        .ok_or(CurveError::Overflow)?;

    let deposit_x = ((x as u128)
        .checked_mul(ratio)
        .ok_or(CurveError::Overflow)?
        .checked_div(PRECISION as u128)
        .ok_or(CurveError::Overflow)?
        .checked_sub(x as u128)
        .ok_or(CurveError::Underflow)?) as u64;

    let deposit_y = ((y as u128)
        .checked_mul(ratio)
        .ok_or(CurveError::Overflow)?
        .checked_div(PRECISION as u128)
        .ok_or(CurveError::Overflow)?
        .checked_sub(y as u128)
        .ok_or(CurveError::Underflow)?) as u64;

    Ok((deposit_x, deposit_y))
}

/// Calculate amounts of X and Y to withdraw when burning `lp_amount` LP tokens
/// ratio = (l - lp_amount) / l
/// withdraw_x = x * (1 - ratio), withdraw_y = y * (1 - ratio)
pub fn xy_withdraw_amounts(
    x: u64,
    y: u64,
    l: u64,
    lp_amount: u64,
) -> Result<(u64, u64), CurveError> {
    if l == 0 || lp_amount > l {
        return Err(CurveError::ZeroBalance);
    }
    let ratio = ((l - lp_amount) as u128)
        .checked_mul(PRECISION as u128)
        .ok_or(CurveError::Overflow)?
        .checked_div(l as u128)
        .ok_or(CurveError::Overflow)?;

    let withdraw_x = ((x as u128)
        .checked_sub(
            (x as u128)
                .checked_mul(ratio)
                .ok_or(CurveError::Overflow)?
                .checked_div(PRECISION as u128)
                .ok_or(CurveError::Overflow)?,
        )
        .ok_or(CurveError::Underflow)?) as u64;

    let withdraw_y = ((y as u128)
        .checked_sub(
            (y as u128)
                .checked_mul(ratio)
                .ok_or(CurveError::Overflow)?
                .checked_div(PRECISION as u128)
                .ok_or(CurveError::Overflow)?,
        )
        .ok_or(CurveError::Underflow)?) as u64;

    Ok((withdraw_x, withdraw_y))
}

/// Calculate LP tokens to mint for first deposit (when l=0)
/// Use max(x, y) as per constant-product-curve to minimize rounding errors
pub fn lp_tokens_for_initial_deposit(x: u64, y: u64) -> Result<u64, CurveError> {
    if x == 0 || y == 0 {
        return Err(CurveError::ZeroBalance);
    }
    Ok(x.max(y))
}
