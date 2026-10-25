import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { ChartSpec } from '@mochi/domain/viz/fence';

export function ChartVisual({ spec }: { spec: ChartSpec }) {
  const config = chartConfig(spec);
  const hasLegend = spec.series.length > 1 || spec.type === 'pie';
  return (
    <ChartContainer
      data-visual-svg
      config={config}
      className="aspect-auto h-60 w-full"
    >
      {spec.type === 'pie' ? (
        <PieChart>
          <ChartTooltip
            content={<ChartTooltipContent nameKey={spec.x} hideLabel />}
          />
          <Pie
            data={spec.data}
            dataKey={spec.series[0]}
            nameKey={spec.x}
            innerRadius="55%"
            strokeWidth={2}
            stroke="var(--card)"
            isAnimationActive={false}
          >
            {spec.data.map((row, i) => (
              <Cell key={String(row[spec.x])} fill={lineColor(i)} />
            ))}
          </Pie>
          <ChartLegend content={<ChartLegendContent nameKey={spec.x} />} />
        </PieChart>
      ) : (
        <CartesianChart spec={spec} hasLegend={hasLegend} />
      )}
    </ChartContainer>
  );
}

const CHARTS = { bar: BarChart, line: LineChart, area: AreaChart } as const;

function CartesianChart({
  spec,
  hasLegend,
}: {
  spec: ChartSpec;
  hasLegend: boolean;
}) {
  const Chart = CHARTS[spec.type as keyof typeof CHARTS];
  return (
    <Chart data={spec.data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
      <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
      <XAxis
        dataKey={spec.x}
        tickLine={false}
        axisLine={{ stroke: 'var(--chart-axis)' }}
        tickMargin={6}
        minTickGap={12}
      />
      <YAxis tickLine={false} axisLine={false} width={44} tickMargin={4} />
      <ChartTooltip
        cursor={
          spec.type === 'bar'
            ? { fill: 'var(--muted)' }
            : { stroke: 'var(--chart-axis)' }
        }
        content={
          <ChartTooltipContent
            indicator={spec.type === 'bar' ? 'dot' : 'line'}
          />
        }
      />
      {hasLegend && <ChartLegend content={<ChartLegendContent />} />}
      {spec.series.map((key, i) => {
        if (spec.type === 'bar')
          return (
            <Bar
              key={key}
              dataKey={key}
              fill={lineColor(i)}
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
              isAnimationActive={false}
            />
          );
        if (spec.type === 'area')
          return (
            <Area
              key={key}
              dataKey={key}
              type="monotone"
              stroke={lineColor(i)}
              strokeWidth={2}
              fill={lineColor(i)}
              fillOpacity={0.16}
              isAnimationActive={false}
            />
          );
        return (
          <Line
            key={key}
            dataKey={key}
            type="monotone"
            stroke={lineColor(i)}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
            isAnimationActive={false}
          />
        );
      })}
    </Chart>
  );
}

// Labels only: colours go straight onto the marks, since ChartConfig's --color-<key> breaks on series names with spaces.
function chartConfig(spec: ChartSpec): ChartConfig {
  const keys =
    spec.type === 'pie'
      ? spec.data.map((row) => String(row[spec.x]))
      : spec.series;
  return Object.fromEntries(keys.map((key) => [key, { label: key }]));
}

function lineColor(i: number) {
  return `var(--chart-${(i % 5) + 1})`;
}
