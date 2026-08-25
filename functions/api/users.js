import { verifyJWT } from '../_utils';

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

    const url = new URL(request.url);
    const pathname = url.pathname;

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
        // 检查是否已存在
        const exist = await db.prepare('SELECT username FROM users WHERE username = ?').bind(username).first();
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

    // ===== PUT 修改用户信息（修改密码或资金） =====
    if (request.method === 'PUT') {
        // 路径格式 /api/users/{username}/password 或 /api/users/capital
        if (pathname.endsWith('/password')) {
            const parts = pathname.split('/');
            const username = parts[parts.length - 2]; // 例如 /api/users/George/password
            const { password } = await request.json();
            if (!password) return new Response(JSON.stringify({ error: '密码不能为空' }), { status: 400 });
            const result = await db.prepare('UPDATE users SET password = ? WHERE username = ?').bind(password, username).run();
            if (result.success) {
                return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
            } else {
                return new Response(JSON.stringify({ error: '更新失败' }), { status: 500 });
            }
        } else if (pathname.endsWith('/capital')) {
            const { username, initial_capital } = await request.json();
            if (username === undefined || initial_capital === undefined) {
                return new Response(JSON.stringify({ error: '缺少参数' }), { status: 400 });
            }
            const result = await db.prepare('UPDATE users SET initial_capital = ? WHERE username = ?').bind(initial_capital, username).run();
            if (result.success) {
                return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
            } else {
                return new Response(JSON.stringify({ error: '更新失败' }), { status: 500 });
            }
        } else {
            return new Response(JSON.stringify({ error: '不支持的 PUT 路径' }), { status: 400 });
        }
    }

    // ===== DELETE 删除用户 =====
    if (request.method === 'DELETE') {
        const username = url.searchParams.get('username');
        if (!username) return new Response(JSON.stringify({ error: '缺少用户名' }), { status: 400 });
        if (username === 'admin') {
            return new Response(JSON.stringify({ error: '不能删除管理员' }), { status: 400 });
        }
        // 先删除该用户的交易记录
        await db.prepare('DELETE FROM trades WHERE username = ?').bind(username).run();
        const result = await db.prepare('DELETE FROM users WHERE username = ?').bind(username).run();
        if (result.success) {
            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        } else {
            return new Response(JSON.stringify({ error: '删除失败' }), { status: 500 });
        }
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
}
