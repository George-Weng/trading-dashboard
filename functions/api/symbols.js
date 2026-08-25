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

    if (request.method === 'GET') {
        const { results } = await db.prepare('SELECT * FROM symbols').all();
        return new Response(JSON.stringify(results), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    if (request.method === 'POST') {
        const { symbol, point_value, tick_size, open_fee_rate, close_fee_rate } = await request.json();
        const { success } = await db.prepare(
            'INSERT INTO symbols (symbol, point_value, tick_size, open_fee_rate, close_fee_rate) VALUES (?, ?, ?, ?, ?)'
        ).bind(symbol, point_value, tick_size, open_fee_rate, close_fee_rate).run();
        return new Response(JSON.stringify({ success }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    return new Response('Method Not Allowed', { status: 405 });
}
