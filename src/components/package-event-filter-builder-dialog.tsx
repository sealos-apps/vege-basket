import { useEffect, useState } from 'react'
import { Plus, Trash } from '@phosphor-icons/react'
import { JournalDatePicker } from '@/components/journal-date-picker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  createPackageEventFilterCondition,
  getDefaultPackageEventFilterValue,
  getPackageEventFilterTodayStamp,
  normalizePackageEventFilterCondition,
  packageEventFilterFieldLabels,
  packageEventFilterFields,
  packageEventFilterOperatorLabels,
  packageEventFilterOperatorsByField,
  parsePackageEventFilterDateRange,
  type PackageEventFilterCondition,
  type PackageEventFilterField,
  type PackageEventFilterJoin,
  type PackageEventFilterOperator,
} from '@/components/package-event-filter'

export function PackageEventFilterBuilderDialog({
  assigneeOptions,
  conditions,
  join,
  onApply,
  onOpenChange,
  open,
}: {
  assigneeOptions: Array<{ id: number; name: string }>
  conditions: PackageEventFilterCondition[]
  join: PackageEventFilterJoin
  onApply: (next: {
    conditions: PackageEventFilterCondition[]
    join: PackageEventFilterJoin
  }) => void
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const [draftJoin, setDraftJoin] = useState<PackageEventFilterJoin>(join)
  const [draftConditions, setDraftConditions] = useState<PackageEventFilterCondition[]>(conditions)

  useEffect(() => {
    if (!open) return
    setDraftJoin(join)
    setDraftConditions(
      conditions.length > 0 ? conditions : [createPackageEventFilterCondition()],
    )
  }, [conditions, join, open])

  function updateCondition(id: string, patch: Partial<PackageEventFilterCondition>) {
    setDraftConditions((current) =>
      current.map((condition) => {
        if (condition.id !== id) return condition
        const next = { ...condition, ...patch }
        if (patch.field) {
          next.operator = packageEventFilterOperatorsByField[patch.field][0]
          next.value = getDefaultPackageEventFilterValue(next.field, next.operator)
        } else if (patch.operator) {
          next.value = getDefaultPackageEventFilterValue(next.field, patch.operator)
        }
        return normalizePackageEventFilterCondition(next)
      }),
    )
  }

  function applyFilters() {
    onApply({
      conditions: draftConditions.map(normalizePackageEventFilterCondition).filter((condition) => (
        condition.operator === 'is_empty' ||
        condition.operator === 'is_not_empty' ||
        Boolean(condition.value.trim())
      )),
      join: draftJoin,
    })
    onOpenChange(false)
  }

  function renderConditionValue(condition: PackageEventFilterCondition) {
    if (condition.operator === 'is_empty' || condition.operator === 'is_not_empty') {
      return <span className="todo-filter-value-hint">无需填写</span>
    }

    if (condition.field === 'title') {
      return (
        <Input
          aria-label="筛选事件标题"
          className="todo-filter-value-input"
          placeholder="输入标题关键词"
          value={condition.value}
          onChange={(event) => updateCondition(condition.id, { value: event.target.value })}
        />
      )
    }

    if (condition.field === 'assignee') {
      return (
        <Select
          value={condition.value}
          onValueChange={(value) => updateCondition(condition.id, { value })}
        >
          <SelectTrigger aria-label="筛选交付人" className="todo-filter-condition-select">
            <SelectValue placeholder="选择交付人" />
          </SelectTrigger>
          <SelectContent>
            {assigneeOptions.map((user) => (
              <SelectItem key={user.id} value={String(user.id)}>
                @{user.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    if (condition.field === 'status') {
      return (
        <Select
          value={condition.value}
          onValueChange={(value) => updateCondition(condition.id, { value })}
        >
          <SelectTrigger aria-label="筛选交付状态" className="todo-filter-condition-select">
            <SelectValue placeholder="选择状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">草稿</SelectItem>
            <SelectItem value="delivering">交付中</SelectItem>
            <SelectItem value="rejected">拒绝交付</SelectItem>
            <SelectItem value="partially_delivered">部分交付</SelectItem>
            <SelectItem value="delivered">已交付</SelectItem>
            <SelectItem value="failed">交付失败</SelectItem>
          </SelectContent>
        </Select>
      )
    }

    if (condition.field === 'type') {
      return (
        <Select
          value={condition.value}
          onValueChange={(value) => updateCondition(condition.id, { value })}
        >
          <SelectTrigger aria-label="筛选事件类型" className="todo-filter-condition-select">
            <SelectValue placeholder="选择类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="init">初始化安装</SelectItem>
            <SelectItem value="upgrade">升级</SelectItem>
          </SelectContent>
        </Select>
      )
    }

    if (condition.operator === 'between') {
      const range = parsePackageEventFilterDateRange(condition.value)
      return (
        <div className="todo-filter-date-range">
          <JournalDatePicker
            ariaLabel="选择交付开始日期"
            className="todo-filter-date-trigger"
            datesWithEntries={[]}
            displayValue={range.start || '开始日期'}
            value={range.start}
            onChange={(value) =>
              updateCondition(condition.id, { value: `${value}..${range.end}` })
            }
          />
          <span className="todo-filter-date-range-separator">至</span>
          <JournalDatePicker
            ariaLabel="选择交付结束日期"
            className="todo-filter-date-trigger"
            datesWithEntries={[]}
            displayValue={range.end || '结束日期'}
            value={range.end}
            onChange={(value) =>
              updateCondition(condition.id, { value: `${range.start}..${value}` })
            }
          />
        </div>
      )
    }

    return (
      <JournalDatePicker
        ariaLabel="选择交付筛选日期"
        className="todo-filter-date-trigger"
        datesWithEntries={[]}
        displayValue={condition.value || '选择日期'}
        value={condition.value || getPackageEventFilterTodayStamp()}
        onChange={(value) => updateCondition(condition.id, { value })}
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="todo-filter-dialog package-event-filter-dialog">
        <DialogHeader>
          <DialogTitle>筛选交付事件</DialogTitle>
          <DialogDescription>
            按交付人、交付日期、状态、标题或类型组合筛选事件。
          </DialogDescription>
        </DialogHeader>
        <div className="todo-filter-join-row">
          <span>匹配方式</span>
          <Select
            value={draftJoin}
            onValueChange={(value) => setDraftJoin(value as PackageEventFilterJoin)}
          >
            <SelectTrigger aria-label="交付事件筛选匹配方式" className="todo-filter-join-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="and">全部满足（且）</SelectItem>
              <SelectItem value="or">任一满足（或）</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="todo-filter-condition-list">
          {draftConditions.length === 0 ? (
            <div className="todo-filter-empty">还没有筛选条件。</div>
          ) : (
            draftConditions.map((condition, index) => (
              <div
                className={
                  condition.field === 'deliveryDate' && condition.operator === 'between'
                    ? 'todo-filter-condition-row date-range'
                    : 'todo-filter-condition-row'
                }
                key={condition.id}
              >
                <span className="todo-filter-condition-index">条件 {index + 1}</span>
                <Select
                  value={condition.field}
                  onValueChange={(value) => updateCondition(condition.id, {
                    field: value as PackageEventFilterField,
                  })}
                >
                  <SelectTrigger aria-label="交付事件筛选字段" className="todo-filter-condition-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {packageEventFilterFields.map((field) => (
                      <SelectItem key={field} value={field}>
                        {packageEventFilterFieldLabels[field]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={condition.operator}
                  onValueChange={(value) => updateCondition(condition.id, {
                    operator: value as PackageEventFilterOperator,
                  })}
                >
                  <SelectTrigger aria-label="交付事件筛选操作符" className="todo-filter-condition-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {packageEventFilterOperatorsByField[condition.field].map((operator) => (
                      <SelectItem key={operator} value={operator}>
                        {packageEventFilterOperatorLabels[operator]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="todo-filter-value-control">
                  {renderConditionValue(condition)}
                </div>
                <Button
                  className="todo-filter-remove-button"
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="删除交付事件筛选条件"
                  onClick={() => setDraftConditions((current) =>
                    current.filter((item) => item.id !== condition.id)
                  )}
                >
                  <Trash size={14} />
                </Button>
              </div>
            ))
          )}
        </div>
        <Button
          className="todo-filter-add-condition ghost-button"
          type="button"
          variant="outline"
          onClick={() => setDraftConditions((current) => [
            ...current,
            createPackageEventFilterCondition(),
          ])}
        >
          <Plus size={14} /> 添加条件
        </Button>
        <DialogFooter>
          <Button
            className="ghost-button"
            type="button"
            variant="outline"
            onClick={() => {
              setDraftConditions([])
              setDraftJoin('and')
            }}
          >
            清空
          </Button>
          <Button
            className="ghost-button"
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button className="solid-button" type="button" onClick={applyFilters}>
            应用筛选
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
