import { verifyJWT } from '../_utils';

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    const authHeader = request.headers.get('Authorization');
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return new Response('Unauthorized', { status: 401 });
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload || payload.role !== 'admin') {
        return new Response('Forbidden', { status: 403 });
    }

    // GET 查询全部
    if (request.method === 'GET') {
        const { results } = await db.prepare('SELECT * FROM symbols').all();
        return new Response(JSON.stringify(results), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // POST 单条
    if (request.method === 'POST' && !request.url.endsWith('/batch')) {
        const { symbol, point_value, tick_size, open_fee_rate, close_fee_rate } = await request.json();
        if (!symbol) return new Response(JSON.stringify({ error: '缺少品种名' }), { status: 400 });
        const result = await db.prepare(
            'INSERT INTO symbols (symbol, point_value, tick_size, open_fee_rate, close_fee_rate) VALUES (?, ?, ?, ?, ?)'
        ).bind(symbol, point_value, tick_size, open_fee_rate, close_fee_rate).run();
        if (result.success) {
            return new Response(JSON.stringify({ success: true }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            return new Response(JSON.stringify({ error: '品种可能已存在' }), { status: 400 });
        }
    }

    // POST 批量导入
    if (request.method === 'POST' && request.url.endsWith('/batch')) {
        const items = await request.json();
        if (!Array.isArray(items) || items.length === 0) {
            return new Response(JSON.stringify({ error: '请提供品种数组' }), { status: 400 });
        }
        let inserted = 0;
        for (const item of items) {
            const { symbol, point_value, tick_size, open_fee_rate, close_fee_rate } = item;
            if (!symbol) continue;
            // 使用 INSERT OR REPLACE 或先删除再插入，简单使用 INSERT OR IGNORE
            const result = await db.prepare(
                'INSERT OR IGNORE INTO symbols (symbol, point_value, tick_size, open_fee_rate, close_fee_rate) VALUES (?, ?, ?, ?, ?)'
            ).bind(symbol, point_value, tick_size, open_fee_rate, close_fee_rate).run();
            if (result.success && result.meta?.rows_written > 0) inserted++;
        }
        return new Response(JSON.stringify({ inserted, total: items.length }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // PUT 更新（略）
    // DELETE 单条（略）

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
}
