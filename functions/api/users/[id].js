import { verifyJWT } from '../../_utils';

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 验证管理员权限
    const authHeader = request.headers.get('Authorization');
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return new Response(JSON.stringify({ error: '未授权' }), { status: 401 });
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload || payload.role !== 'admin') {
        return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403 });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;
    const parts = pathname.split('/');
    const username = parts[parts.length - 1];

    if (!username) {
        return new Response(JSON.stringify({ error: '缺少用户名' }), { status: 400 });
    }

    // ===== DELETE 删除用户 =====
    if (request.method === 'DELETE') {
        if (username === 'admin') {
            return new Response(JSON.stringify({ error: '不能删除管理员' }), { status: 400 });
        }
        await db.prepare('DELETE FROM trades WHERE username = ?').bind(username).run();
        const result = await db.prepare('DELETE FROM users WHERE username = ?').bind(username).run();
        if (result.success) {
            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        } else {
            return new Response(JSON.stringify({ error: '删除失败' }), { status: 500 });
        }
    }

    // ===== PUT 修改密码或资金 =====
    if (request.method === 'PUT') {
        const body = await request.json();
        // 优先判断 password
        if (body.password !== undefined) {
            const result = await db.prepare('UPDATE users SET password = ? WHERE username = ?').bind(body.password, username).run();
            if (result.success) {
                return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
            } else {
                return new Response(JSON.stringify({ error: '更新密码失败' }), { status: 500 });
            }
        }
        // 其次判断 initial_capital
        else if (body.initial_capital !== undefined) {
            const result = await db.prepare('UPDATE users SET initial_capital = ? WHERE username = ?').bind(body.initial_capital, username).run();
            if (result.success) {
                return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
            } else {
                return new Response(JSON.stringify({ error: '更新资金失败' }), { status: 500 });
            }
        } else {
            return new Response(JSON.stringify({ error: '缺少更新字段' }), { status: 400 });
        }
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
}
