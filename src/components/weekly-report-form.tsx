import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Label } from './ui/label'
import { Badge } from './ui/badge'
import { MarkdownPreview } from './markdown-preview'
import {
  weeklyReportProfiles,
  type WeeklyReportSourceCandidate,
} from '../../shared/weekly-report-profile'
import {
  createWeeklyReportItem,
  createWeeklyReportTask,
  formatWeeklyReportPercent,
  getWeeklyReportProgress,
  hasTaskContent,
  isValidTaskPercent,
  parseWeeklyReportDocument,
  serializeWeeklyReportDocument,
  weeklyReportTaskStatus,
  weeklyReportValidationError,
  type WeeklyReportDocument,
  type WeeklyReportProgressSummary,
  type WeeklyReportTask,
} from '../../shared/weekly-report-document'
import './weekly-report-form.css'

export function WeeklyReportProgress({
  summary,
  title = '本周任务平均进度',
}: {
  summary: WeeklyReportProgressSummary | null
  title?: string
}) {
  if (!summary)
    return (
      <p className="wr-progress-empty">{title}：— · 历史周报未记录任务进度</p>
    )
  return (
    <section className="wr-progress" aria-label={title}>
      <div>
        <span>
          {title}
          {summary.isProvisional ? ' · 暂算' : ''}
        </span>
        <strong>
          {formatWeeklyReportPercent(summary.averagePercent)}{' '}
          <small>{summary.taskCount} 项任务</small>
        </strong>
        <progress
          aria-label={title}
          max={100}
          value={summary.averagePercent ?? 0}
        />
      </div>
      <div>
        <p>
          已完成 {summary.completedCount} 进行中 {summary.inProgressCount}{' '}
          未开始 {summary.notStartedCount}
        </p>
        <small>
          {summary.isProvisional
            ? `还有 ${summary.missingProgressCount} 项未填进度，当前按 ${summary.measuredTaskCount} 项暂算`
            : `所有任务等权平均 · 进度合计 ${summary.percentSum} ÷ ${summary.measuredTaskCount} 项`}
        </small>
      </div>
    </section>
  )
}

export function WeeklyReportReading({ content }: { content: string }) {
  const document = useMemo(() => parseWeeklyReportDocument(content), [content])
  if (!document) return <MarkdownPreview content={content} />
  const labels = weeklyReportProfiles[document.profile]
  return (
    <article className="wr-reading">
      <WeeklyReportProgress summary={getWeeklyReportProgress(document.items)} />
      {document.goal ? (
        <section>
          <h3>{labels.goal}</h3>
          <MarkdownPreview content={document.goal} />
        </section>
      ) : null}
      {document.items
        .filter((item) => item.title.trim() || item.tasks.some(hasTaskContent))
        .map((item, index) => (
          <section key={item.id}>
            <h3>
              {String(index + 1).padStart(2, '0')} {item.title}
              <small>
                事项平均{' '}
                {formatWeeklyReportPercent(
                  getWeeklyReportProgress([item]).averagePercent,
                )}
              </small>
            </h3>
            <h4>{labels.progress}</h4>
            <div className="wr-reading-tasks">
              {item.tasks.filter(hasTaskContent).map((task) => (
                <div key={task.id}>
                  <header>
                    <strong>{task.title}</strong>
                    <span>
                      {formatWeeklyReportPercent(task.progressPercent)}
                    </span>
                    <Badge variant="secondary">
                      {weeklyReportTaskStatus(task.progressPercent)}
                    </Badge>
                  </header>
                  <MarkdownPreview content={task.description} />
                  <progress
                    aria-label={`${task.title}进度`}
                    max={100}
                    value={task.progressPercent ?? 0}
                  />
                </div>
              ))}
            </div>
            <h4>{labels.risk}</h4>
            <MarkdownPreview content={item.risk || '未填写'} />
            <h4>{labels.plan}</h4>
            <MarkdownPreview content={item.plan || '未填写'} />
          </section>
        ))}
    </article>
  )
}

export type WeeklyReportFormHandle = {
  validate: () => boolean
  insertSources: (
    sources: WeeklyReportSourceCandidate[],
    asItems?: boolean,
    target?: 'progress' | 'risk' | 'plan',
  ) => void
}
export const WeeklyReportForm = forwardRef<
  WeeklyReportFormHandle,
  { content: string; disabled?: boolean; onChange: (content: string) => void }
>(function WeeklyReportForm({ content, disabled = false, onChange }, ref) {
  const document = useMemo(() => parseWeeklyReportDocument(content), [content])
  const [active, setActive] = useState(0)
  const [validation, setValidation] = useState(false)
  const [undo, setUndo] = useState<{
    before: WeeklyReportDocument
    after: string
  } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  function emit(next: WeeklyReportDocument) {
    onChange(serializeWeeklyReportDocument(next))
  }
  function edit(fn: (next: WeeklyReportDocument) => void) {
    if (!document || disabled) return
    const next = structuredClone(document)
    fn(next)
    emit(next)
  }
  function deleteWithUndo(fn: (next: WeeklyReportDocument) => void) {
    if (!document || disabled) return
    const next = structuredClone(document)
    fn(next)
    const after = serializeWeeklyReportDocument(next)
    setUndo({ before: document, after })
    onChange(after)
  }
  function focusName(group: number, task?: number) {
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLInputElement>(
          task === undefined
            ? `[data-item-name="${group}"]`
            : `[data-task-name="${group}:${task}"]`,
        )
        ?.focus(),
    )
  }
  function validate() {
    if (!document) return false
    setValidation(true)
    const error = weeklyReportValidationError(document)
    if (!error) return true
    const group = Math.max(
      0,
      document.items.findIndex(
        (item) =>
          !item.title.trim() ||
          !item.tasks.some(hasTaskContent) ||
          item.tasks
            .filter(hasTaskContent)
            .some(
              (t) =>
                !t.title.trim() ||
                !t.description.trim() ||
                !isValidTaskPercent(t.progressPercent),
            ),
      ),
    )
    setActive(group)
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus(),
    )
    return false
  }
  useImperativeHandle(ref, () => ({
    validate,
    insertSources(sources, asItems = false, target = 'progress') {
      edit((next) => {
        for (const source of sources) {
          const stats = source.personalExecutionStats
          const description = stats
            ? `${source.title} · ${source.testSubjects?.map((s) => s.name).join('、') || source.testSpaceName} ${source.versionLabel || ''}\n本人本周期保留的最新执行记录：${stats.total} 条，通过 ${stats.passed}、失败 ${stats.failed}、阻塞 ${stats.blocked}、跳过 ${stats.skipped}。`
            : `${source.title}（来源当前状态：${source.status}；${source.matchReason}）`
          const task = {
            ...createWeeklyReportTask('new'),
            title: source.title,
            description,
          }
          if (asItems || !next.items[active]) {
            const item = createWeeklyReportItem('new')
            item.title = source.title
            item.tasks = [task]
            next.items.push(item)
            setActive(next.items.length - 1)
          } else if (target === 'progress') next.items[active].tasks.push(task)
          else
            next.items[active][target] +=
              (next.items[active][target] ? '\n' : '') + description
        }
      })
    },
  }))
  if (!document) return null
  const labels = weeklyReportProfiles[document.profile]
  const updateTask = (
    group: number,
    index: number,
    patch: Partial<WeeklyReportTask>,
  ) => edit((next) => Object.assign(next.items[group].tasks[index], patch))
  return (
    <div className="wr-form" ref={root}>
      <fieldset disabled={disabled}>
        <Label htmlFor="wr-goal">
          {labels.goal} <small>选填</small>
        </Label>
        <Textarea
          id="wr-goal"
          value={document.goal}
          onChange={(e) =>
            edit((next) => {
              next.goal = e.target.value
            })
          }
        />
      </fieldset>
      <WeeklyReportProgress summary={getWeeklyReportProgress(document.items)} />
      <div className="wr-items-heading">
        <h3>
          {labels.item} <small>{document.items.length} 项</small>
        </h3>
        <span>每个事项可新增多项任务</span>
      </div>
      {validation && weeklyReportValidationError(document) ? (
        <p role="alert" className="wr-validation">
          {weeklyReportValidationError(document)}
        </p>
      ) : null}
      {document.items.map((item, group) => (
        <section className="wr-item" key={item.id}>
          <header>
            <button
              type="button"
              aria-expanded={active === group}
              onClick={() => setActive(active === group ? -1 : group)}
            >
              <span>{String(group + 1).padStart(2, '0')}</span>
              <strong>
                {item.title || '未命名事项'}
                <small>
                  {item.tasks.filter(hasTaskContent).length} 项任务 ·{' '}
                  {formatWeeklyReportPercent(
                    getWeeklyReportProgress([item]).averagePercent,
                  )}
                </small>
              </strong>
            </button>
            <div>
              <Button
                aria-label="上移事项"
                size="icon"
                variant="ghost"
                disabled={disabled || group === 0}
                onClick={() => {
                  edit((next) => {
                    ;[next.items[group - 1], next.items[group]] = [
                      next.items[group],
                      next.items[group - 1],
                    ]
                  })
                  setActive(group - 1)
                }}
              >
                <ArrowUp />
              </Button>
              <Button
                aria-label="下移事项"
                size="icon"
                variant="ghost"
                disabled={disabled || group === document.items.length - 1}
                onClick={() => {
                  edit((next) => {
                    ;[next.items[group + 1], next.items[group]] = [
                      next.items[group],
                      next.items[group + 1],
                    ]
                  })
                  setActive(group + 1)
                }}
              >
                <ArrowDown />
              </Button>
              <Button
                aria-label="删除事项"
                size="icon"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  deleteWithUndo((next) => {
                    next.items.splice(group, 1)
                  })
                  setActive(Math.max(0, group - 1))
                }}
              >
                <Trash />
              </Button>
            </div>
          </header>
          {active === group ? (
            <fieldset disabled={disabled}>
              <Label htmlFor={`wr-item-${group}`}>{labels.item}名称 *</Label>
              <Input
                id={`wr-item-${group}`}
                data-item-name={group}
                aria-invalid={validation && !item.title.trim()}
                value={item.title}
                onChange={(e) =>
                  edit((next) => {
                    next.items[group].title = e.target.value
                  })
                }
              />
              <h4>
                {labels.progress} <small>可添加多项任务</small>
              </h4>
              <p className="wr-hint">
                0% 未开始 · 1–99% 进行中 · 100% 已完成
                {document.profile === 'tester' ? '；独立于用例通过率。' : ''}
              </p>
              {item.tasks.map((task, index) => {
                const invalid = validation && hasTaskContent(task)
                return (
                  <fieldset className="wr-task" key={task.id}>
                    <div className="wr-task-heading">
                      <span>任务 {String(index + 1).padStart(2, '0')}</span>
                      <div>
                        <Button
                          aria-label="上移任务"
                          size="icon"
                          variant="ghost"
                          disabled={index === 0 || disabled}
                          onClick={() =>
                            edit((next) => {
                              const tasks = next.items[group].tasks
                              ;[tasks[index - 1], tasks[index]] = [
                                tasks[index],
                                tasks[index - 1],
                              ]
                            })
                          }
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          aria-label="下移任务"
                          size="icon"
                          variant="ghost"
                          disabled={index === item.tasks.length - 1 || disabled}
                          onClick={() =>
                            edit((next) => {
                              const tasks = next.items[group].tasks
                              ;[tasks[index + 1], tasks[index]] = [
                                tasks[index],
                                tasks[index + 1],
                              ]
                            })
                          }
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          aria-label="删除任务"
                          size="icon"
                          variant="ghost"
                          disabled={disabled}
                          onClick={() => {
                            deleteWithUndo((next) => {
                              next.items[group].tasks.splice(index, 1)
                            })
                          }}
                        >
                          <Trash />
                        </Button>
                      </div>
                    </div>
                    <div className="wr-task-grid">
                      <div>
                        <Label htmlFor={`wr-task-title-${group}-${index}`}>
                          任务名称 *
                        </Label>
                        <Input
                          id={`wr-task-title-${group}-${index}`}
                          data-task-name={`${group}:${index}`}
                          aria-invalid={invalid && !task.title.trim()}
                          value={task.title}
                          onChange={(e) =>
                            updateTask(group, index, { title: e.target.value })
                          }
                        />
                        <Label
                          htmlFor={`wr-task-description-${group}-${index}`}
                        >
                          任务进展 *
                        </Label>
                        <Textarea
                          id={`wr-task-description-${group}-${index}`}
                          aria-invalid={invalid && !task.description.trim()}
                          value={task.description}
                          onChange={(e) =>
                            updateTask(group, index, {
                              description: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label htmlFor={`wr-task-percent-${group}-${index}`}>
                          任务进度（%）*
                        </Label>
                        <Input
                          id={`wr-task-percent-${group}-${index}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={100}
                          step={1}
                          aria-invalid={
                            invalid && !isValidTaskPercent(task.progressPercent)
                          }
                          placeholder="待填写"
                          value={task.progressPercent ?? ''}
                          onChange={(e) => {
                            const value =
                              e.target.value === ''
                                ? null
                                : Number(e.target.value)
                            if (value !== null && !isValidTaskPercent(value))
                              setValidation(true)
                            updateTask(group, index, {
                              progressPercent:
                                value === null || isValidTaskPercent(value)
                                  ? value
                                  : null,
                            })
                          }}
                        />
                        <progress
                          aria-label="任务完成进度"
                          max={100}
                          value={task.progressPercent ?? 0}
                        />
                        <Label>任务状态 · 自动</Label>
                        <Badge variant="secondary">
                          {weeklyReportTaskStatus(task.progressPercent)}
                        </Badge>
                      </div>
                    </div>
                  </fieldset>
                )
              })}
              <Button
                className="wr-add-task"
                variant="outline"
                type="button"
                onClick={() => {
                  edit((next) =>
                    next.items[group].tasks.push(createWeeklyReportTask('new')),
                  )
                  focusName(group, item.tasks.length)
                }}
              >
                <Plus data-icon="inline-start" />
                新增一项{document.profile === 'tester' ? '测试' : ''}任务
              </Button>
              <div className="wr-two-fields">
                {(['risk', 'plan'] as const).map((key) => (
                  <div key={key}>
                    <Label htmlFor={`wr-${key}-${group}`}>
                      {labels[key]} <small>选填</small>
                    </Label>
                    <Textarea
                      id={`wr-${key}-${group}`}
                      value={item[key]}
                      onChange={(e) =>
                        edit((next) => {
                          next.items[group][key] = e.target.value
                        })
                      }
                    />
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  setValidation(true)
                  if (
                    weeklyReportValidationError({ ...document, items: [item] })
                  )
                    return
                  edit((next) => next.items.push(createWeeklyReportItem('new')))
                  setActive(document.items.length)
                  setValidation(false)
                  focusName(document.items.length)
                }}
              >
                保存此项并添加下一事项
              </Button>
            </fieldset>
          ) : null}
        </section>
      ))}
      {undo && undo.after === content ? (
        <div className="wr-undo" role="status">
          已删除，平均进度已重新计算。
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              emit(undo.before)
              setUndo(null)
            }}
          >
            撤销
          </Button>
        </div>
      ) : null}
      <Button
        variant="outline"
        type="button"
        disabled={disabled}
        onClick={() => {
          edit((next) => next.items.push(createWeeklyReportItem('new')))
          setActive(document.items.length)
          setValidation(false)
          focusName(document.items.length)
        }}
      >
        <Plus data-icon="inline-start" />
        添加{labels.item}
      </Button>
    </div>
  )
})
