import type { ColumnType } from 'antd/es/table';

/** 序号列：`page + pageSize` 与后端分页对齐；不传则为本表当前数据 1…n（无服务端分页时使用） */
export function serialColumn<T>(page?: number, pageSize?: number, opts?: { width?: number }): ColumnType<T> {
  const width = opts?.width ?? 64;
  return {
    title: '序号',
    key: '__serial',
    width,
    align: 'center',
    render: (_value: unknown, _record: T, index: number) =>
      page != null && pageSize != null ? (page - 1) * pageSize + index + 1 : index + 1
  };
}
