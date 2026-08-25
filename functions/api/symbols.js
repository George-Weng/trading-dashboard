import { verifyJWT } from '../_utils';

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

    // ===== GET 全部品种 =====
    if (request.method === 'GET') {
        const { results } = await db.prepare('SELECT * FROM symbols ORDER BY symbol').all();
        return new Response(JSON.stringify(results), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // ===== POST 单条添加 =====
    if (request.method === 'POST' && !pathname.endsWith('/batch')) {
        const { symbol, point_value, tick_size, open_fee_rate, close_fee_rate } = await request.json();
        if (!symbol) return new Response(JSON.stringify({ error: '缺少品种名' }), { status: 400 });
        // 检查是否存在
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

    // ===== POST 批量导入 =====
    if (request.method === 'POST' && pathname.endsWith('/batch')) {
        const items = await request.json();
        if (!Array.isArray(items) || items.length === 0) {
            return new Response(JSON.stringify({ error: '请提供品种数组' }), { status: 400 });
        }

        let inserted = 0;
        const errors = [];
        for (const item of items) {
            const { symbol, point_value, tick_size, open_fee_rate, close_fee_rate } = item;
            // 校验字段
            if (!symbol || isNaN(point_value) || isNaN(tick_size) || isNaN(open_fee_rate) || isNaN(close_fee_rate)) {
                errors.push(`品种 "${symbol || '未命名'}" 数据不完整，跳过`);
                continue;
            }
            // 使用 INSERT OR REPLACE 避免重复
            const result = await db.prepare(
                `INSERT OR REPLACE INTO symbols 
                (symbol, point_value, tick_size, open_fee_rate, close_fee_rate)
                VALUES (?, ?, ?, ?, ?)`
            ).bind(symbol, point_value, tick_size, open_fee_rate, close_fee_rate).run();
            if (result.success && result.meta?.rows_written > 0) {
                inserted++;
            } else {
                errors.push(`品种 "${symbol}" 插入失败`);
            }
        }

        return new Response(JSON.stringify({ inserted, total: items.length, errors }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // ===== PUT 更新 =====
    if (request.method === 'PUT') {
        const { old_symbol, symbol, point_value, tick_size, open_fee_rate, close_fee_rate } = await request.json();
        if (!old_symbol) return new Response(JSON.stringify({ error: '缺少原品种名' }), { status: 400 });
        const result = await db.prepare(
            `UPDATE symbols SET 
            symbol = ?, point_value = ?, tick_size = ?, open_fee_rate = ?, close_fee_rate = ?
            WHERE symbol = ?`
        ).bind(symbol, point_value, tick_size, open_fee_rate, close_fee_rate, old_symbol).run();
        if (result.success) {
            return new Response(JSON.stringify({ success: true }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            return new Response(JSON.stringify({ error: '更新失败' }), { status: 500 });
        }
    }

    // ===== DELETE 单条 =====
    if (request.method === 'DELETE') {
        const symbol = url.searchParams.get('symbol');
        if (!symbol) return new Response(JSON.stringify({ error: '缺少品种名' }), { status: 400 });
        const result = await db.prepare('DELETE FROM symbols WHERE symbol = ?').bind(symbol).run();
        if (result.success) {
            return new Response(JSON.stringify({ success: true }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            return new Response(JSON.stringify({ error: '删除失败' }), { status: 500 });
        }
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
}
