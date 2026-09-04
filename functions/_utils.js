import jwt from '@tsndr/cloudflare-worker-jwt';

export async function verifyJWT(token, secret) {
    try {
        const valid = await jwt.verify(token, secret);
        if (!valid) return null;
        const { payload } = jwt.decode(token);
        return payload;
    } catch {
        return null;
    }
}

// 公共计算函数（含止盈位计算，已按新公式修正）
export async function calculateTrade(db, tradeData) {
    const config = await db.prepare('SELECT * FROM symbols WHERE symbol = ?').bind(tradeData.symbol).first();
    if (!config) {
        return {
            ...tradeData,
            profit: null,
            profit_points: null,
            open_fee: 0,
            close_fee: 0,
            point_value: 0,
            tick_size: 0,
            tp1: null,
            tp2: null
        };
    }
    const { point_value, tick_size, open_fee_rate, close_fee_rate } = config;
    const openPrice = tradeData.open_price;
    const closePrice = tradeData.close_price;
    const volume = tradeData.volume;
    const direction = tradeData.direction;
    const stopLoss = tradeData.stop_loss;

    // 手续费
    const openFee = openPrice * volume * open_fee_rate;
    const closeFee = closePrice ? closePrice * volume * close_fee_rate : 0;

    // 盈亏计算（仅平仓时）
    let profitPoints = null;
    let profit = null;
    if (closePrice !== null && closePrice !== undefined) {
        if (direction === '买入') {
            profitPoints = (closePrice - openPrice) / tick_size * volume;
        } else {
            profitPoints = (openPrice - closePrice) / tick_size * volume;
        }
        profit = profitPoints * point_value * volume - openFee - closeFee;
    }

    // 止盈价位（按新公式）
    let tp1 = null, tp2 = null;
    if (stopLoss !== null && stopLoss !== undefined) {
        const tick = tick_size;
        // 根据方向调整符号
        const adjust = direction === '买入' ? tick : -tick;
        // diff1 = (开仓价 - 止损) + adjust
        const diff1 = openPrice - stopLoss + adjust;
        const diff2 = diff1 * 2;
        // 最终止盈价位 = 开仓价 + diff，并取绝对值
        tp1 = Math.abs(openPrice + diff1);
        tp2 = Math.abs(openPrice + diff2);
    }

    return {
        ...tradeData,
        profit: profit !== null ? parseFloat(profit.toFixed(2)) : null,
        profit_points: profitPoints !== null ? parseFloat(profitPoints.toFixed(2)) : null,
        open_fee: parseFloat(openFee.toFixed(2)),
        close_fee: parseFloat(closeFee.toFixed(2)),
        point_value,
        tick_size,
        tp1: tp1 !== null ? parseFloat(tp1.toFixed(6)) : null,
        tp2: tp2 !== null ? parseFloat(tp2.toFixed(6)) : null,
    };
}
