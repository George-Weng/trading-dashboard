import jwt from '@tsndr/cloudflare-worker-jwt';

export async function verifyJWT(token, secret) {
    try {
        const valid = await jwt.verify(token, secret);
        if (!valid) return null;
        const { payload } = jwt.decode(token);
        return payload;
    } catch {
        return null;
    }
}
