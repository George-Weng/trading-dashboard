import { verifyJWT } from '../../_utils';

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    const authHeader = request.headers.get('Authorization');
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return new Response(JSON.stringify({ error: '未授权' }), { status: 401 });
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload) return new Response(JSON.stringify({ error: '无效 token' }), { status: 401 });

    const url = new URL(request.url);
    const pathname = url.pathname;
    const parts = pathname.split('/');
    const username = parts[parts.length - 1];

    if (!username) {
        return new Response(JSON.stringify({ error: '缺少用户名' }), { status: 400 });
    }

    // DELETE：仅管理员
    if (request.method === 'DELETE') {
        if (payload.role !== 'admin') {
            return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403 });
        }
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

    // PUT：允许修改密码（本人或管理员）或修改资金（仅管理员）
    if (request.method === 'PUT') {
        const body = await request.json();
        const isAdmin = payload.role === 'admin';
        const isSelf = payload.username === username;

        // 非管理员且非本人，无权修改
        if (!isAdmin && !isSelf) {
            return new Response(JSON.stringify({ error: '无权修改该用户' }), { status: 403 });
        }

        // 修改密码
        if (body.password !== undefined) {
            // 任何人只能修改自己的密码（管理员可修改任何人的）
            if (!isAdmin && !isSelf) {
                return new Response(JSON.stringify({ error: '无权修改该用户密码' }), { status: 403 });
            }
            const result = await db.prepare('UPDATE users SET password = ? WHERE username = ?')
                .bind(body.password, username).run();
            if (result.success) {
                return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
            } else {
                return new Response(JSON.stringify({ error: '更新密码失败' }), { status: 500 });
            }
        }

        // 修改初始资金（仅管理员）
        if (body.initial_capital !== undefined) {
            if (!isAdmin) {
                return new Response(JSON.stringify({ error: '仅管理员可修改资金' }), { status: 403 });
            }
            const result = await db.prepare('UPDATE users SET initial_capital = ? WHERE username = ?')
                .bind(body.initial_capital, username).run();
            if (result.success) {
                return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
            } else {
                return new Response(JSON.stringify({ error: '更新资金失败' }), { status: 500 });
            }
        }

        return new Response(JSON.stringify({ error: '缺少更新字段' }), { status: 400 });
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
}
