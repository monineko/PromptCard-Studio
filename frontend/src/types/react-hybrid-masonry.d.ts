// react-hybrid-masonry@1.0.1 未附带 .d.ts，这里补最小类型声明（可替换 Gallery 封装所需的接口）。
declare module "react-hybrid-masonry" {
  import type { ReactElement } from "react";

  export interface MasonryLayoutItem<T = Record<string, unknown>> extends Record<string, unknown> {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  export interface VirtualMasonryProps<T = Record<string, unknown>> {
    loadData: (page: number, pageSize: number) => Promise<{ data: T[]; hasMore: boolean }>;
    renderItem: (item: T & MasonryLayoutItem<T>, index: number) => ReactElement;
    pageSize?: number;
    minColumnWidth?: number;
    maxColumnWidth?: number;
    gap?: number;
    buffer?: number;
    loadMoreThreshold?: number;
  }

  export function VirtualMasonry<T = Record<string, unknown>>(props: VirtualMasonryProps<T>): ReactElement;
  export function FullWidthEqualHeightMasonry<T = Record<string, unknown>>(
    props: VirtualMasonryProps<T>
  ): ReactElement;
}
