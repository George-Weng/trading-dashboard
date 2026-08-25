import { verifyJWT } from '../_utils';

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 验证 JWT
    const authHeader = request.headers.get('Authorization');
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return new Response(JSON.stringify({ error: '未授权' }), { status: 401 });
    }
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload) {
        return new Response(JSON.stringify({ error: '无效 token' }), { status: 401 });
    }
    const { username, role } = payload;

    // GET 查询
    if (request.method === 'GET') {
        let query = 'SELECT * FROM trades';
        const params = [];
        if (role === 'trader') {
            query += ' WHERE username = ?';
            params.push(username);
        }
        const { results } = await db.prepare(query).bind(...params).all();
        return new Response(JSON.stringify(results), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // POST 新增
    if (request.method === 'POST') {
        const tradeData = await request.json();
        // 强制归属：交易员只能写自己的，管理员可指定
        if (role === 'trader') {
            tradeData.username = username;
        } else if (role === 'admin' && !tradeData.username) {
            tradeData.username = username; // fallback
        }

        const { success } = await db.prepare(
            `INSERT INTO trades 
            (username, date, symbol, direction, stop_loss, open_price, volume, close_price, 
             profit, profit_points, open_fee, close_fee, point_value, tick_size)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            tradeData.username,
            tradeData.date,
            tradeData.symbol,
            tradeData.direction,
            tradeData.stop_loss || null,
            tradeData.open_price,
            tradeData.volume,
            tradeData.close_price || null,
            tradeData.profit || 0,
            tradeData.profit_points || 0,
            tradeData.open_fee || 0,
            tradeData.close_fee || 0,
            tradeData.point_value || 0,
            tradeData.tick_size || 0
        ).run();

        if (success) {
            // 返回最新插入的记录（简化：返回全部）
            const { results } = await db.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT 1').all();
            return new Response(JSON.stringify(results[0]), {
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            return new Response(JSON.stringify({ error: '插入失败' }), { status: 500 });
        }
    }

    return new Response('Method Not Allowed', { status: 405 });
}
