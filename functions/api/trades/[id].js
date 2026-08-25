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
    const id = pathname.split('/').pop();

    if (!id || isNaN(id)) {
        return new Response(JSON.stringify({ error: '无效的 ID' }), { status: 400 });
    }

    // ===== GET 单条（可选） =====
    if (request.method === 'GET') {
        const { results } = await db.prepare('SELECT * FROM trades WHERE id = ?').bind(id).all();
        if (results.length === 0) return new Response(JSON.stringify({ error: '记录不存在' }), { status: 404 });
        return new Response(JSON.stringify(results[0]), { headers: { 'Content-Type': 'application/json' } });
    }

    // ===== PUT 更新 =====
    if (request.method === 'PUT') {
        // 权限检查
        const check = await db.prepare('SELECT username FROM trades WHERE id = ?').bind(id).first();
        if (!check) return new Response(JSON.stringify({ error: '记录不存在' }), { status: 404 });
        if (role === 'trader' && check.username !== username) {
            return new Response(JSON.stringify({ error: '无权修改' }), { status: 403 });
        }

        const tradeData = await request.json();
        const result = await db.prepare(
            `UPDATE trades SET 
            date = ?, symbol = ?, direction = ?, stop_loss = ?, open_price = ?, volume = ?,
            close_price = ?, profit = ?, profit_points = ?, open_fee = ?, close_fee = ?,
            point_value = ?, tick_size = ?
            WHERE id = ?`
        ).bind(
            tradeData.date, tradeData.symbol, tradeData.direction,
            tradeData.stop_loss || null, tradeData.open_price, tradeData.volume,
            tradeData.close_price || null,
            tradeData.profit || 0, tradeData.profit_points || 0,
            tradeData.open_fee || 0, tradeData.close_fee || 0,
            tradeData.point_value || 0, tradeData.tick_size || 0,
            id
        ).run();
        if (result.success) {
            const { results } = await db.prepare('SELECT * FROM trades WHERE id = ?').bind(id).all();
            return new Response(JSON.stringify(results[0]), { headers: { 'Content-Type': 'application/json' } });
        } else {
            return new Response(JSON.stringify({ error: '更新失败' }), { status: 500 });
        }
    }

    // ===== DELETE 单条 =====
    if (request.method === 'DELETE') {
        const check = await db.prepare('SELECT username FROM trades WHERE id = ?').bind(id).first();
        if (!check) return new Response(JSON.stringify({ error: '记录不存在' }), { status: 404 });
        if (role === 'trader' && check.username !== username) {
            return new Response(JSON.stringify({ error: '无权删除' }), { status: 403 });
        }
        const result = await db.prepare('DELETE FROM trades WHERE id = ?').bind(id).run();
        if (result.success) {
            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        } else {
            return new Response(JSON.stringify({ error: '删除失败' }), { status: 500 });
        }
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
}
