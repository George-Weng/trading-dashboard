import { verifyJWT } from '../_utils';

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 验证 JWT
    const authHeader = request.headers.get('Authorization');
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return new Response('Unauthorized', { status: 401 });
    const payload = await verifyJWT(token, env.JWT_SECRET);
    if (!payload || payload.role !== 'admin') {
        return new Response('Forbidden', { status: 403 });
    }

    if (request.method === 'GET') {
        const { results } = await db.prepare('SELECT id, username, role, initial_capital FROM users').all();
        return new Response(JSON.stringify(results), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    if (request.method === 'POST') {
        const { username, password, role, initial_capital } = await request.json();
        const { success } = await db.prepare(
            'INSERT INTO users (username, password, role, initial_capital) VALUES (?, ?, ?, ?)'
        ).bind(username, password, role, initial_capital || 0).run();
        return new Response(JSON.stringify({ success }), {
            headers: { 'Content-Type': 'application/json' }
        });
    }

    return new Response('Method Not Allowed', { status: 405 });
}
