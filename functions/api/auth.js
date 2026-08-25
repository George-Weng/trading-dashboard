// 临时调试：返回环境变量是否设置
return new Response(JSON.stringify({ secret: env.JWT_SECRET ? 'exists' : 'missing' }), {
    headers: { 'Content-Type': 'application/json' }
});



import jwt from '@tsndr/cloudflare-worker-jwt';

export async function onRequest(context) {
    const { request, env } = context;
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const { username, password } = await request.json();
        const db = env.DB;

        const user = await db.prepare(
            'SELECT id, username, role FROM users WHERE username = ? AND password = ?'
        ).bind(username, password).first();

        if (!user) {
            return new Response(JSON.stringify({ error: '用户名或密码错误' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const token = await jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        return new Response(JSON.stringify({ token, username: user.username, role: user.role }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
}
