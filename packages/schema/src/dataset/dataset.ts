import type { Infer, Schema } from '../foundation/types.js'
import { mock } from '../generator/engine.js'
import { generateDataset, type DatasetOptions } from './generate.js'
export { identityFor, type DatasetOptions } from './generate.js'
/** Standard convenience composition; runtime.mockDataset binds a selected registry. */
export const mockDataset = <S extends Schema>(options: DatasetOptions<S>): Infer<S>[] => generateDataset(options, mock)
