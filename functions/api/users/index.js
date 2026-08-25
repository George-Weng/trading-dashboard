import { verifyJWT } from '../../_utils';

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    const authHeader = request.headers.get('Authorization');
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return new Response(JSON.stringify({ error: '未授权' }), { status: 401 });
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload || payload.role !== 'admin') {
        return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403 });
    }

    // ===== GET 所有用户 =====
    if (request.method === 'GET') {
        const { results } = await db.prepare('SELECT id, username, role, initial_capital FROM users').all();
        return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
    }

    // ===== POST 新增用户 =====
    if (request.method === 'POST') {
        const { username, password, role, initial_capital } = await request.json();
        if (!username || !password) {
            return new Response(JSON.stringify({ error: '用户名和密码必填' }), { status: 400 });
        }
        const exist = await db.prepare('SELECT username FROM users WHERE LOWER(username) = LOWER(?)').bind(username).first();
        if (exist) return new Response(JSON.stringify({ error: '用户名已存在' }), { status: 400 });
        const cap = role === 'trader' ? (initial_capital || 0) : 0;
        const result = await db.prepare(
            'INSERT INTO users (username, password, role, initial_capital) VALUES (?, ?, ?, ?)'
        ).bind(username, password, role, cap).run();
        if (result.success) {
            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        } else {
            return new Response(JSON.stringify({ error: '插入失败' }), { status: 500 });
        }
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
}
