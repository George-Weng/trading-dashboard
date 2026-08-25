import { verifyJWT } from '../../_utils';

// 同样需要计算函数（或从外部导入，这里为了完整复制一份）
async function calculateTrade(db, tradeData) {
    const symbolConfig = await db.prepare('SELECT * FROM symbols WHERE symbol = ?').bind(tradeData.symbol).first();
    if (!symbolConfig) {
        return { ...tradeData, profit: 0, profit_points: 0, open_fee: 0, close_fee: 0, point_value: 0, tick_size: 0 };
    }
    const { point_value, tick_size, open_fee_rate, close_fee_rate } = symbolConfig;
    const openPrice = tradeData.open_price;
    const closePrice = tradeData.close_price;
    const volume = tradeData.volume;
    const direction = tradeData.direction;

    const openFee = openPrice * volume * open_fee_rate;
    const closeFee = closePrice ? closePrice * volume * close_fee_rate : 0;

    let profitPoints = 0;
    if (closePrice !== null && closePrice !== undefined) {
        if (direction === '买入') {
            profitPoints = (closePrice - openPrice) / tick_size * volume;
        } else if (direction === '卖出') {
            profitPoints = (openPrice - closePrice) / tick_size * volume;
        }
    }
    const profit = profitPoints * point_value * volume - openFee - closeFee;

    return {
        ...tradeData,
        profit: parseFloat(profit.toFixed(2)),
        profit_points: parseFloat(profitPoints.toFixed(2)),
        open_fee: parseFloat(openFee.toFixed(2)),
        close_fee: parseFloat(closeFee.toFixed(2)),
        point_value,
        tick_size,
    };
}

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
    }

    const authHeader = request.headers.get('Authorization');
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return new Response(JSON.stringify({ error: '未授权' }), { status: 401 });
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload) return new Response(JSON.stringify({ error: '无效 token' }), { status: 401 });
    const { username, role } = payload;

    const trades = await request.json();
    if (!Array.isArray(trades) || trades.length === 0) {
        return new Response(JSON.stringify({ error: '请提供交易数组' }), { status: 400 });
    }

    let inserted = 0;
    for (const item of trades) {
        let targetUser = item.username;
        if (role === 'trader') targetUser = username;
        else if (role === 'admin' && !targetUser) continue;
        else if (!targetUser) targetUser = username;

        // 计算盈亏
        const calculated = await calculateTrade(db, { ...item, username: targetUser });

        const { success } = await db.prepare(
            `INSERT INTO trades 
            (username, date, symbol, direction, stop_loss, open_price, volume, close_price, 
             profit, profit_points, open_fee, close_fee, point_value, tick_size)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            calculated.username,
            calculated.date,
            calculated.symbol,
            calculated.direction,
            calculated.stop_loss || null,
            calculated.open_price,
            calculated.volume,
            calculated.close_price || null,
            calculated.profit,
            calculated.profit_points,
            calculated.open_fee,
            calculated.close_fee,
            calculated.point_value,
            calculated.tick_size
        ).run();
        if (success) inserted++;
    }
    return new Response(JSON.stringify({ inserted, total: trades.length }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
