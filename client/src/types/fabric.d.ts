declare module 'fabric' {
  export interface IObjectOptions {
    stroke?: string
    strokeWidth?: number
    fill?: string | null
    strokeLineCap?: string
    strokeLineJoin?: string
    selectable?: boolean
    evented?: boolean
  }

  export class Path {
    constructor(pathData: string, options?: IObjectOptions)
    get(property: string): unknown
    set(property: string, value: unknown): this
    setCoords(): void
  }

  export class Canvas {
    constructor(element: HTMLCanvasElement | string | null, options?: Record<string, unknown>)
    width?: number
    height?: number
    backgroundColor?: string
    isDrawingMode?: boolean
    upperCanvasEl?: HTMLCanvasElement
    add(...objects: FabricObject[]): this
    remove(...objects: FabricObject[]): this
    clear(): this
    renderAll(): this
    getPointer(e: MouseEvent): { x: number; y: number }
    setWidth(value: number): this
    setHeight(value: number): this
    dispose(): void
    on(eventName: string, handler: (e: { e: MouseEvent }) => void): void
    off(eventName: string): void
  }

  export class Circle {
    constructor(options?: Record<string, unknown>)
    get(property: string): unknown
    set(property: string, value: unknown): this
    setCoords(): void
  }

  export type FabricObject = Path | Circle

  export const fabric: {
    Canvas: typeof Canvas
    Path: typeof Path
    Circle: typeof Circle
  }
}
