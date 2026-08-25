import { verifyJWT } from '../../_utils';

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
    }

    const authHeader = request.headers.get('Authorization');
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return new Response(JSON.stringify({ error: '未授权' }), { status: 401 });
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload || payload.role !== 'admin') {
        return new Response(JSON.stringify({ error: '需要管理员权限' }), { status: 403 });
    }

    const items = await request.json();
    if (!Array.isArray(items) || items.length === 0) {
        return new Response(JSON.stringify({ error: '请提供品种数组' }), { status: 400 });
    }

    let inserted = 0;
    const errors = [];
    for (const item of items) {
        const { symbol, point_value, tick_size, open_fee_rate, close_fee_rate } = item;
        if (!symbol || isNaN(point_value) || isNaN(tick_size) || isNaN(open_fee_rate) || isNaN(close_fee_rate)) {
            errors.push(`品种 "${symbol || '未命名'}" 数据不完整`);
            continue;
        }
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
