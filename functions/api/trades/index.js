import { verifyJWT, calculateTrade } from '../../_utils';

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    const authHeader = request.headers.get('Authorization');
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return new Response(JSON.stringify({ error: '未授权' }), { status: 401 });
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload) return new Response(JSON.stringify({ error: '无效 token' }), { status: 401 });
    const { username, role } = payload;

    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === 'GET') {
        const targetUser = url.searchParams.get('user');
        let query = 'SELECT * FROM trades';
        const params = [];
        if (role === 'trader') {
            query += ' WHERE username = ?';
            params.push(username);
        } else if (role === 'admin' && targetUser) {
            query += ' WHERE username = ?';
            params.push(targetUser);
        }
        query += ' ORDER BY id DESC';  // 最新添加在前
        const { results } = await db.prepare(query).bind(...params).all();
        return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
    }

    if (request.method === 'POST' && !pathname.endsWith('/calculate-all')) {
        const tradeData = await request.json();
        let targetUser = tradeData.username;
        if (role === 'trader') targetUser = username;
        else if (role === 'admin' && !targetUser) {
            return new Response(JSON.stringify({ error: '管理员必须指定交易员用户名' }), { status: 400 });
        } else if (!targetUser) targetUser = username;

        const calculated = await calculateTrade(db, { ...tradeData, username: targetUser });

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
        if (success) {
            const { results } = await db.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT 1').all();
            return new Response(JSON.stringify(results[0]), { headers: { 'Content-Type': 'application/json' } });
        } else {
            return new Response(JSON.stringify({ error: '插入失败' }), { status: 500 });
        }
    }

    if (request.method === 'POST' && pathname.endsWith('/calculate-all')) {
        if (role !== 'admin') {
            return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403 });
        }
        const { results: allTrades } = await db.prepare('SELECT * FROM trades').all();
        let updated = 0;
        for (const trade of allTrades) {
            const calculated = await calculateTrade(db, trade);
            const result = await db.prepare(
                `UPDATE trades SET 
                profit = ?, profit_points = ?, open_fee = ?, close_fee = ?,
                point_value = ?, tick_size = ?, tp1 = ?, tp2 = ?
                WHERE id = ?`
            ).bind(
                calculated.profit, calculated.profit_points,
                calculated.open_fee, calculated.close_fee,
                calculated.point_value, calculated.tick_size,
                calculated.tp1, calculated.tp2,
                trade.id
            ).run();
            if (result.success) updated++;
        }
        return new Response(JSON.stringify({ success: true, updated }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    if (request.method === 'DELETE') {
        if (role !== 'admin') return new Response(JSON.stringify({ error: '权限不足' }), { status: 403 });
        const targetUser = url.searchParams.get('user');
        let query = 'DELETE FROM trades';
        const params = [];
        if (targetUser) { query += ' WHERE username = ?'; params.push(targetUser); }
        const result = await db.prepare(query).bind(...params).run();
        if (result.success) {
            return new Response(JSON.stringify({ success: true, deleted: result.meta?.rows_written || 0 }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            return new Response(JSON.stringify({ error: '清空失败' }), { status: 500 });
        }
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
}
