import { verifyJWT } from '../../_utils';

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    const authHeader = request.headers.get('Authorization');
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return new Response(JSON.stringify({ error: '未授权' }), { status: 401 });
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload) return new Response(JSON.stringify({ error: '无效 token' }), { status: 401 });

    // GET 请求允许所有认证用户（包括 trader）
    if (request.method === 'GET') {
        const { results } = await db.prepare('SELECT * FROM symbols ORDER BY symbol').all();
        return new Response(JSON.stringify(results), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // 非 GET 请求（POST/PUT/DELETE）需要管理员权限
    if (payload.role !== 'admin') {
        return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403 });
    }

    if (request.method === 'POST') {
        const { symbol, point_value, tick_size, open_fee_rate, close_fee_rate } = await request.json();
        if (!symbol) return new Response(JSON.stringify({ error: '缺少品种名' }), { status: 400 });
        const exist = await db.prepare('SELECT symbol FROM symbols WHERE symbol = ?').bind(symbol).first();
        if (exist) return new Response(JSON.stringify({ error: '品种已存在' }), { status: 400 });
        const result = await db.prepare(
            'INSERT INTO symbols (symbol, point_value, tick_size, open_fee_rate, close_fee_rate) VALUES (?, ?, ?, ?, ?)'
        ).bind(symbol, point_value, tick_size, open_fee_rate, close_fee_rate).run();
        if (result.success) {
            return new Response(JSON.stringify({ success: true }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            return new Response(JSON.stringify({ error: '插入失败' }), { status: 500 });
        }
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
}
