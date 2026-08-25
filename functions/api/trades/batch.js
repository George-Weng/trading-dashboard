import { verifyJWT } from '../../_utils';

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

        const { success } = await db.prepare(
            `INSERT INTO trades 
            (username, date, symbol, direction, stop_loss, open_price, volume, close_price, 
             profit, profit_points, open_fee, close_fee, point_value, tick_size)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            targetUser, item.date, item.symbol, item.direction,
            item.stop_loss || null, item.open_price, item.volume,
            item.close_price || null,
            item.profit || 0, item.profit_points || 0,
            item.open_fee || 0, item.close_fee || 0,
            item.point_value || 0, item.tick_size || 0
        ).run();
        if (success) inserted++;
    }
    return new Response(JSON.stringify({ inserted, total: trades.length }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
