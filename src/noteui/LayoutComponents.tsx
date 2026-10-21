import type { ComponentType } from 'react'
import RichText from '../components/RichText'
import { Box, Card, Carousel, Col, Divider, Grid, Popover, Row, Spacer, type Align, type Gap } from './primitives'
import type { LayoutData, LayoutName } from './parser'
import { noteUIRegistry } from '../../shared/noteuiRegistry'

function Layout({ name, data, params }: { name: LayoutName; data: LayoutData; params: Record<string, string> }) {
  const cells = data.cells.map((source, i) => <div className="nui-cell" key={i}><RichText text={source} /></div>)
  const props = { children: cells, gap: params.gap as Gap | undefined, align: params.align as Align | undefined }
  switch (name) {
    case 'row': return <Row {...props} />
    case 'col': return <Col {...props} />
    case 'box': return <Box {...props} tone={params.tone as 'plain' | 'soft'} />
    case 'grid': return <Grid {...props} columns={Number(params.columns ?? 2) as 2 | 3 | 4} />
    case 'card': return <Card {...props} tone={params.tone as 'outline' | 'soft'} />
    case 'carousel': return <Carousel {...props} />
    case 'popover': return <Popover title={params.title ?? '附加说明'}>{cells}</Popover>
    case 'divider': return <Divider />
    case 'spacer': return <Spacer size={params.size as Gap} />
  }
}
export const layoutRegistry = Object.fromEntries((['row', 'col', 'box', 'grid', 'card', 'divider', 'spacer', 'carousel', 'popover'] as const).map(name => [name, { label: noteUIRegistry[name].label, render: (props: { data: LayoutData; params: Record<string, string> }) => <Layout {...props} name={name} /> }])) as Record<LayoutName, { label: string; render: ComponentType<{ data: LayoutData; params: Record<string, string> }> }>
