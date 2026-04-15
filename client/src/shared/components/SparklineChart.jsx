import { ResponsiveContainer, LineChart, Line, Tooltip } from 'recharts';

/**
 * Minimal sparkline chart using Recharts.
 * Props:
 *   data   number[]  — array of values
 *   color  string    — line color
 *   height number    — chart height (default 40)
 */
export function SparklineChart({ data = [], color = '#1d4ed8', height = 40 }) {
  if (!data || data.length < 2) return null;

  const chartData = data.map((v, i) => ({ i, v }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={true}
          animationDuration={800}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            return (
              <div style={{
                background: '#1e293b',
                color: '#f1f5f9',
                padding: '4px 8px',
                borderRadius: 4,
                fontSize: '0.7rem',
                fontWeight: 600,
              }}>
                {payload[0].value}
              </div>
            );
          }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
