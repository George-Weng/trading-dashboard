import { verifyJWT } from '../_utils';

export async function onRequest(context) {
    try {
        const { request, env } = context;
        const db = env.DB;

        const authHeader = request.headers.get('Authorization');
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) return new Response(JSON.stringify({ error: '未授权' }), { status: 401 });
        const payload = await verifyJWT(token, env.JWT_SECRET);
        if (!payload) return new Response(JSON.stringify({ error: '无效 token' }), { status: 401 });
        const { username, role } = payload;

        const url = new URL(request.url);
        const targetUser = url.searchParams.get('user');

        let userCondition = '';
        const params = [];
        if (role === 'trader') {
            userCondition = 'AND username = ?';
            params.push(username);
        } else if (role === 'admin' && targetUser) {
            userCondition = 'AND username = ?';
            params.push(targetUser);
        } else if (role === 'admin' && !targetUser) {
            userCondition = 'AND username IN (SELECT username FROM users WHERE role = ?)';
            params.push('trader');
        }

        // KPI（增加 lossTrades）
        const kpiQuery = `
            SELECT 
                COUNT(*) as totalTrades,
                SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) as winTrades,
                SUM(CASE WHEN profit < 0 THEN 1 ELSE 0 END) as lossTrades,
                SUM(profit) as totalProfit,
                SUM(open_fee + close_fee) as totalFee,
                SUM(CASE WHEN profit > 0 THEN profit ELSE 0 END) as totalWin,
                SUM(CASE WHEN profit < 0 THEN -profit ELSE 0 END) as totalLoss
            FROM trades
            WHERE close_price IS NOT NULL ${userCondition}
        `;
        const { results: kpiResults } = await db.prepare(kpiQuery).bind(...params).all();
        const kpi = kpiResults?.[0] || {};

        // 总资本
        let capitalQuery = 'SELECT SUM(initial_capital) as totalCapital FROM users WHERE role = ?';
        const capitalParams = ['trader'];
        if (role === 'trader') {
            capitalQuery += ' AND username = ?';
            capitalParams.push(username);
        } else if (role === 'admin' && targetUser) {
            capitalQuery += ' AND username = ?';
            capitalParams.push(targetUser);
        }
        const { results: capitalResults } = await db.prepare(capitalQuery).bind(...capitalParams).all();
        const capitalResult = capitalResults?.[0] || {};
        const totalCapital = capitalResult.totalCapital || 0;

        // 月度
        const monthQuery = `
            SELECT substr(date, 6, 2) as month, SUM(profit) as profit
            FROM trades
            WHERE close_price IS NOT NULL ${userCondition}
            GROUP BY substr(date, 6, 2)
            ORDER BY month
        `;
        const { results: monthResults } = await db.prepare(monthQuery).bind(...params).all();
        const monthMap = {};
        (monthResults || []).forEach(m => { monthMap[m.month] = m.profit; });
        const monthlyProfit = [];
        for (let i = 1; i <= 12; i++) {
            const key = String(i).padStart(2, '0');
            monthlyProfit.push(monthMap[key] || 0);
        }

        // 每日
        const dailyQuery = `
            SELECT date, SUM(profit) as profit
            FROM trades
            WHERE close_price IS NOT NULL ${userCondition}
            AND date >= date('now', '-30 days')
            GROUP BY date
            ORDER BY date
        `;
        const { results: dailyResults } = await db.prepare(dailyQuery).bind(...params).all();

        // 周净值
        const allTradesQuery = `
            SELECT date, profit
            FROM trades
            WHERE close_price IS NOT NULL ${userCondition}
            ORDER BY date
        `;
        const { results: allTrades } = await db.prepare(allTradesQuery).bind(...params).all();

        let weekLabels = ['初始'];
        let weeklyEquity = [1.0];

        if (allTrades && allTrades.length > 0) {
            function getISOWeek(date) {
                const d = new Date(date);
                d.setHours(0,0,0,0);
                d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
                const week1 = new Date(d.getFullYear(), 0, 4);
                const week = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
                return { year: d.getFullYear(), week };
            }

            const weekMap = new Map();
            for (const trade of allTrades) {
                const date = new Date(trade.date);
                const { year, week } = getISOWeek(date);
                const key = `${year}-${String(week).padStart(2, '0')}`;
                const current = weekMap.get(key) || 0;
                weekMap.set(key, current + (trade.profit || 0));
            }

            const sortedKeys = Array.from(weekMap.keys()).sort();
            let cumProfit = 0;
            for (const key of sortedKeys) {
                const [year, week] = key.split('-').map(Number);
                cumProfit += weekMap.get(key) || 0;
                const equity = totalCapital > 0 ? (totalCapital + cumProfit) / totalCapital : 1;
                weeklyEquity.push(parseFloat(equity.toFixed(4)));
                weekLabels.push(`WK${String(week).padStart(2, '0')}`);
            }
        }

        if (weeklyEquity.length === 1) {
            weeklyEquity.push(1.0);
            weekLabels.push('当前');
        }

        const response = {
            kpi: {
                totalTrades: kpi.totalTrades || 0,
                winTrades: kpi.winTrades || 0,
                lossTrades: kpi.lossTrades || 0,
                totalProfit: kpi.totalProfit || 0,
                totalFee: kpi.totalFee || 0,
                totalWin: kpi.totalWin || 0,
                totalLoss: kpi.totalLoss || 0,
                totalCapital,
            },
            monthly: {
                labels: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
                data: monthlyProfit,
            },
            daily: {
                labels: (dailyResults || []).map(d => d.date),
                data: (dailyResults || []).map(d => d.profit || 0),
            },
            weekly: {
                labels: weekLabels,
                data: weeklyEquity,
            }
        };

        return new Response(JSON.stringify(response), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
