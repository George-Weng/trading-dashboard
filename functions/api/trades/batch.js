import { verifyJWT, calculateTrade } from '../../_utils';

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

        const calculated = await calculateTrade(db, { ...item, username: targetUser });

        const { success } = await db.prepare(
            `INSERT INTO trades 
            (username, date, symbol, direction, stop_loss, open_price, volume, close_price, 
             profit, profit_points, open_fee, close_fee, point_value, tick_size, tp1, tp2)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            calculated.username, calculated.date, calculated.symbol, calculated.direction,
            calculated.stop_loss || null, calculated.open_price, calculated.volume,
            calculated.close_price || null,
            calculated.profit, calculated.profit_points,
            calculated.open_fee, calculated.close_fee,
            calculated.point_value, calculated.tick_size,
            calculated.tp1, calculated.tp2
        ).run();
        if (success) inserted++;
    }
    return new Response(JSON.stringify({ inserted, total: trades.length }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
