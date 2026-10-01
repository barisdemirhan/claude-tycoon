// The game as buttons and text, for the surfaces that draw no screen of the
// game's own. It lists what the screen lists, and every press is the key the
// screen would take.

import type { Elements, RenderElement } from 'claude-code'

import type { TycoonSave, TycoonView } from '../types'
import type { Generator, Upgrade } from './catalog'
import { price, short } from './format'
import {
  ALL_KEY,
  QTY_KEY,
  ROW_KEYS,
  SHIP_KEY,
  TABS,
  generatorRows,
  recordLines,
  shipLabel,
  shipLines,
  upgradeRows,
} from './screen'
import type { Line } from './screen'
import { clickOf, openUpgrades, priceOf, weightsDue } from './sim'

// The elements every surface that draws a pane has.
type Kit = Pick<Elements['mobile'], 'Box' | 'Button' | 'Text'>
type Press = (key: string) => void

const MINE_KEY = 'm'

const tabs = (
  { Box, Button }: Kit,
  save: TycoonSave,
  view: TycoonView,
  press: Press,
): RenderElement => {
  const open = openUpgrades(save).filter(upgrade => upgrade.cost <= save.tokens)
  const marks: Readonly<Record<string, string>> = {
    upgrades: open.length === 0 ? '' : ` (${open.length})`,
    ship: weightsDue(save) === 0 ? '' : ' (!)',
  }

  return (
    <Box columnGap={2} flexWrap="wrap">
      {TABS.map(({ tab, key, name }) => (
        <Button
          key={`tab-${tab}`}
          plain
          hotkey={key}
          label={`${name}${marks[tab] ?? ''}`}
          dimColor={tab !== view.tab}
          onPress={() => press(key)}
        />
      ))}
      <Button
        key="mine"
        plain
        hotkey={MINE_KEY}
        autoFocus
        label={`Mine +${short(clickOf(save))}`}
        onPress={() => press(MINE_KEY)}
      />
    </Box>
  )
}

const generatorRow = (
  { Button }: Kit,
  generator: Generator,
  at: number,
  save: TycoonSave,
  view: TycoonView,
  press: Press,
): RenderElement => {
  const owned = save.owned[generator.id] ?? 0
  const cost = priceOf(generator, owned, view.qty)
  const key = ROW_KEYS[at] ?? ''

  return (
    <Button
      key={`gen-${generator.id}`}
      plain
      hotkey={key}
      label={`${generator.name} ×${owned} · ◈${price(cost)}`}
      dimColor={save.tokens < cost}
      onPress={() => press(key)}
    />
  )
}

const upgradeRow = (
  { Box, Button, Text }: Kit,
  upgrade: Upgrade,
  at: number,
  save: TycoonSave,
  press: Press,
): RenderElement => {
  const key = ROW_KEYS[at] ?? ''

  return (
    <Box>
      <Button
        key={`up-${upgrade.id}`}
        plain
        hotkey={key}
        label={`${upgrade.name} · ◈${price(upgrade.cost)}`}
        dimColor={save.tokens < upgrade.cost}
        onPress={() => press(key)}
      />
      <Text dimColor wrap="truncate-end">
        {'  '}
        {upgrade.note}
      </Text>
    </Box>
  )
}

const said = ({ Text }: Kit, lines: readonly Line[]): RenderElement[] =>
  lines.map(line => <Text dimColor={line.isDim === true}>{line.text}</Text>)

/** The tabs and the tab in view. */
export const body = (
  kit: Kit,
  save: TycoonSave,
  view: TycoonView,
  press: Press,
): RenderElement => {
  const { Box, Button, Text } = kit
  const listed = upgradeRows(save)
  const shown: Readonly<Record<TycoonView['tab'], () => RenderElement[]>> = {
    build: () => [
      ...generatorRows(save).map((generator, at) =>
        generatorRow(kit, generator, at, save, view, press),
      ),
      <Button
        key="qty"
        plain
        hotkey={QTY_KEY}
        label={`Buy ${view.qty} at a time`}
        dimColor
        onPress={() => press(QTY_KEY)}
      />,
    ],
    upgrades: () =>
      listed.length === 0
        ? [<Text dimColor>No upgrade is open yet.</Text>]
        : [
            ...listed.map((upgrade, at) => upgradeRow(kit, upgrade, at, save, press)),
            <Button
              key="up-all"
              plain
              hotkey={ALL_KEY}
              label="Buy every upgrade the balance covers"
              dimColor
              onPress={() => press(ALL_KEY)}
            />,
          ],
    records: () => said(kit, recordLines(save)),
    ship: () => [
      ...said(kit, shipLines(save)),
      ...(weightsDue(save) > 0
        ? [
            <Button
              key="ship"
              hotkey={SHIP_KEY}
              variant="primary"
              label={`${SHIP_KEY}: ${shipLabel(save, view)}`}
              onPress={() => press(SHIP_KEY)}
            />,
          ]
        : []),
    ],
  }

  return (
    <Box flexDirection="column">
      {tabs(kit, save, view, press)}
      {shown[view.tab]()}
    </Box>
  )
}
