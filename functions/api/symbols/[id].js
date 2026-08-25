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

    const url = new URL(request.url);
    const pathname = url.pathname;
    const symbol = pathname.split('/').pop();

    if (!symbol) {
        return new Response(JSON.stringify({ error: '缺少品种名' }), { status: 400 });
    }

    if (request.method === 'DELETE') {
        // 检查是否有交易引用
        const ref = await db.prepare('SELECT id FROM trades WHERE symbol = ? LIMIT 1').bind(symbol).first();
        if (ref) {
            return new Response(JSON.stringify({ error: '该品种已被交易记录引用，无法删除' }), { status: 400 });
        }
        const result = await db.prepare('DELETE FROM symbols WHERE symbol = ?').bind(symbol).run();
        if (result.success) {
            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        } else {
            return new Response(JSON.stringify({ error: '删除失败' }), { status: 500 });
        }
    }

    if (request.method === 'PUT') {
        const { symbol: newSymbol, point_value, tick_size, open_fee_rate, close_fee_rate } = await request.json();
        if (!newSymbol) return new Response(JSON.stringify({ error: '缺少新品种名' }), { status: 400 });
        const result = await db.prepare(
            `UPDATE symbols SET 
            symbol = ?, point_value = ?, tick_size = ?, open_fee_rate = ?, close_fee_rate = ?
            WHERE symbol = ?`
        ).bind(newSymbol, point_value, tick_size, open_fee_rate, close_fee_rate, symbol).run();
        if (result.success) {
            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
        } else {
            return new Response(JSON.stringify({ error: '更新失败' }), { status: 500 });
        }
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
}
