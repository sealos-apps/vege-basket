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
  bugFilterFieldLabels,
  bugFilterFields,
  bugFilterOperatorLabels,
  bugFilterOperatorsByField,
  createBugFilterCondition,
  getBugFilterTodayStamp,
  getDefaultBugFilterValue,
  normalizeBugFilterCondition,
  parseBugFilterDateRange,
  type BugFilterCondition,
  type BugFilterField,
  type BugFilterJoin,
  type BugFilterOperator,
} from '@/components/bug-filter'

export type BugFilterOption = { label: string; value: string }

export type BugFilterOptions = {
  assignees: BugFilterOption[]
  plans: BugFilterOption[]
  reporters: BugFilterOption[]
  spaces: BugFilterOption[]
  cases: BugFilterOption[]
  folders: BugFilterOption[]
}

const statusOptions: BugFilterOption[] = [
  { label: '待确认', value: 'new' },
  { label: '待修复', value: 'assigned' },
  { label: '修复中', value: 'in_progress' },
  { label: '待验证', value: 'pending_verification' },
  { label: '已驳回', value: 'rejected' },
  { label: '已关闭', value: 'closed' },
]

const severityOptions: BugFilterOption[] = [
  { label: '阻断', value: 'blocker' },
  { label: '严重', value: 'critical' },
  { label: '主要', value: 'major' },
  { label: '次要', value: 'minor' },
  { label: '轻微', value: 'trivial' },
]

const priorityOptions: BugFilterOption[] = [
  { label: '高', value: 'high' },
  { label: '中', value: 'medium' },
  { label: '低', value: 'low' },
]

function optionsForField(field: BugFilterField, options: BugFilterOptions) {
  if (field === 'testSpace') return options.spaces
  if (field === 'testCase') return options.cases
  if (field === 'caseFolder') return options.folders
  if (field === 'testPlan') return options.plans
  if (field === 'reporter') return options.reporters
  if (field === 'assignee') return options.assignees
  if (field === 'status') return statusOptions
  if (field === 'severity') return severityOptions
  if (field === 'priority') return priorityOptions
  return []
}

export function BugFilterBuilderDialog({
  conditions,
  includeTestSpace = true,
  join,
  onApply,
  onOpenChange,
  open,
  options,
}: {
  conditions: BugFilterCondition[]
  includeTestSpace?: boolean
  join: BugFilterJoin
  onApply: (next: { conditions: BugFilterCondition[]; join: BugFilterJoin }) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  options: BugFilterOptions
}) {
  const [draftJoin, setDraftJoin] = useState<BugFilterJoin>(join)
  const [draftConditions, setDraftConditions] = useState<BugFilterCondition[]>(conditions)
  const availableFields = includeTestSpace
    ? bugFilterFields
    : bugFilterFields.filter((field) => field !== 'testSpace')

  useEffect(() => {
    if (!open) return
    setDraftJoin(join)
    const visibleConditions = includeTestSpace
      ? conditions
      : conditions.filter((condition) => condition.field !== 'testSpace')
    setDraftConditions(visibleConditions.length > 0 ? visibleConditions : [createBugFilterCondition()])
  }, [conditions, includeTestSpace, join, open])

  function updateCondition(id: string, patch: Partial<BugFilterCondition>) {
    setDraftConditions((current) => current.map((condition) => {
      if (condition.id !== id) return condition
      const next = { ...condition, ...patch }
      if (patch.field) {
        next.operator = bugFilterOperatorsByField[patch.field][0]
        next.value = getDefaultBugFilterValue(next.field, next.operator)
      } else if (patch.operator) {
        next.value = getDefaultBugFilterValue(next.field, patch.operator)
      }
      return normalizeBugFilterCondition(next)
    }))
  }

  function applyFilters() {
    onApply({
      conditions: draftConditions.map(normalizeBugFilterCondition).filter((condition) => (
        condition.operator === 'is_empty' ||
        condition.operator === 'is_not_empty' ||
        Boolean(condition.value.trim())
      )),
      join: draftJoin,
    })
    onOpenChange(false)
  }

  function renderConditionValue(condition: BugFilterCondition) {
    if (condition.operator === 'is_empty' || condition.operator === 'is_not_empty') {
      return <span className="todo-filter-value-hint">无需填写</span>
    }

    if (condition.field === 'title' || condition.field === 'environment') {
      return (
        <Input
          aria-label={`筛选${bugFilterFieldLabels[condition.field]}`}
          className="todo-filter-value-input"
          placeholder={condition.field === 'title' ? '输入标题关键词' : '输入环境关键词'}
          value={condition.value}
          onChange={(event) => updateCondition(condition.id, { value: event.target.value })}
        />
      )
    }

    if (condition.field === 'createdAt') {
      if (condition.operator === 'between') {
        const range = parseBugFilterDateRange(condition.value)
        return (
          <div className="todo-filter-date-range">
            <JournalDatePicker
              ariaLabel="选择 Bug 创建开始日期"
              className="todo-filter-date-trigger"
              datesWithEntries={[]}
              displayValue={range.start || '开始日期'}
              value={range.start}
              onChange={(value) => updateCondition(condition.id, {
                value: `${value}..${range.end}`,
              })}
            />
            <span className="todo-filter-date-range-separator">至</span>
            <JournalDatePicker
              ariaLabel="选择 Bug 创建结束日期"
              className="todo-filter-date-trigger"
              datesWithEntries={[]}
              displayValue={range.end || '结束日期'}
              value={range.end}
              onChange={(value) => updateCondition(condition.id, {
                value: `${range.start}..${value}`,
              })}
            />
          </div>
        )
      }
      return (
        <JournalDatePicker
          ariaLabel="选择 Bug 创建日期"
          className="todo-filter-date-trigger"
          datesWithEntries={[]}
          displayValue={condition.value || '选择日期'}
          value={condition.value || getBugFilterTodayStamp()}
          onChange={(value) => updateCondition(condition.id, { value })}
        />
      )
    }

    const fieldOptions = optionsForField(condition.field, options)
    return (
      <Select
        value={condition.value}
        onValueChange={(value) => updateCondition(condition.id, { value })}
      >
        <SelectTrigger
          aria-label={`筛选${bugFilterFieldLabels[condition.field]}`}
          className="todo-filter-condition-select"
        >
          <SelectValue placeholder={`选择${bugFilterFieldLabels[condition.field]}`} />
        </SelectTrigger>
        <SelectContent>
          {fieldOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="todo-filter-dialog bug-filter-dialog">
        <DialogHeader>
          <DialogTitle>筛选 Bug</DialogTitle>
          <DialogDescription>
            根据 Bug 信息和测试关联关系组合筛选当前工作台。
          </DialogDescription>
        </DialogHeader>
        <div className="todo-filter-join-row">
          <span>匹配方式</span>
          <Select value={draftJoin} onValueChange={(value) => setDraftJoin(value as BugFilterJoin)}>
            <SelectTrigger aria-label="Bug 筛选匹配方式" className="todo-filter-join-select">
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
          ) : draftConditions.map((condition, index) => (
            <div
              className={condition.field === 'createdAt' && condition.operator === 'between'
                ? 'todo-filter-condition-row date-range'
                : 'todo-filter-condition-row'}
              key={condition.id}
            >
              <span className="todo-filter-condition-index">条件 {index + 1}</span>
              <Select
                value={condition.field}
                onValueChange={(value) => updateCondition(condition.id, {
                  field: value as BugFilterField,
                })}
              >
                <SelectTrigger aria-label="Bug 筛选字段" className="todo-filter-condition-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableFields.map((field) => (
                    <SelectItem key={field} value={field}>{bugFilterFieldLabels[field]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={condition.operator}
                onValueChange={(value) => updateCondition(condition.id, {
                  operator: value as BugFilterOperator,
                })}
              >
                <SelectTrigger aria-label="Bug 筛选条件" className="todo-filter-condition-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {bugFilterOperatorsByField[condition.field].map((operator) => (
                    <SelectItem key={operator} value={operator}>
                      {bugFilterOperatorLabels[operator]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="todo-filter-value-control">{renderConditionValue(condition)}</div>
              <Button
                aria-label={`删除条件 ${index + 1}`}
                className="todo-filter-remove-button"
                size="icon"
                type="button"
                variant="ghost"
                onClick={() => setDraftConditions((current) => (
                  current.filter((item) => item.id !== condition.id)
                ))}
              >
                <Trash />
              </Button>
            </div>
          ))}
        </div>
        <Button
          className="todo-filter-add-condition"
          type="button"
          variant="outline"
          onClick={() => setDraftConditions((current) => [
            ...current,
            createBugFilterCondition(),
          ])}
        >
          <Plus /> 添加条件
        </Button>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setDraftConditions([])}>清空</Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" onClick={applyFilters}>应用筛选</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
