# @framefields/compositions

## 2.0.6

## 2.0.5

## 2.0.4

## 2.0.3

## 2.0.2

## 2.0.1

## 2.0.0

### Patch Changes

- 985e6be: `LayerAnimation.signal()` and `.colorSignal()` now accept a signal object (`Signal.fromArray`, `Signal.builder`, …) as well as a name registered with `comp.addSignal`. Before, passing the object produced a meaningless handle id and the track silently did nothing (or picked up an unrelated signal). The object is carried on its track and registered with the program under a generated `inline_signal_N` id, so specs stay plain JSON. Values that are neither a signal nor a name now throw.

## 1.4.3

## 1.4.2

## 1.4.1

## 1.4.0

## 1.3.2

## 1.3.1

### Patch Changes

- init
