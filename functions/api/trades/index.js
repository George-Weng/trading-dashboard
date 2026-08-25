import { verifyJWT } from '../../_utils';

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

    // ===== GET 列表 =====
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
        query += ' ORDER BY date DESC, id DESC';
        const { results } = await db.prepare(query).bind(...params).all();
        return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
    }

    // ===== POST 新增（单条） =====
    if (request.method === 'POST') {
        const tradeData = await request.json();
        let targetUser = tradeData.username;
        if (role === 'trader') targetUser = username;
        else if (role === 'admin' && !targetUser) {
            return new Response(JSON.stringify({ error: '管理员必须指定交易员用户名' }), { status: 400 });
        } else if (!targetUser) targetUser = username;

        const { success } = await db.prepare(
            `INSERT INTO trades 
            (username, date, symbol, direction, stop_loss, open_price, volume, close_price, 
             profit, profit_points, open_fee, close_fee, point_value, tick_size)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            targetUser, tradeData.date, tradeData.symbol, tradeData.direction,
            tradeData.stop_loss || null, tradeData.open_price, tradeData.volume,
            tradeData.close_price || null,
            tradeData.profit || 0, tradeData.profit_points || 0,
            tradeData.open_fee || 0, tradeData.close_fee || 0,
            tradeData.point_value || 0, tradeData.tick_size || 0
        ).run();
        if (success) {
            const { results } = await db.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT 1').all();
            return new Response(JSON.stringify(results[0]), { headers: { 'Content-Type': 'application/json' } });
        } else {
            return new Response(JSON.stringify({ error: '插入失败' }), { status: 500 });
        }
    }

    // ===== DELETE 清空 =====
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
