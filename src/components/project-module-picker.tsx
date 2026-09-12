import { useState } from 'react'
import { Plus, X } from '@phosphor-icons/react'
import type { ProjectModule } from '../types'
import { projectModuleUnavailableLabel } from '../../shared/project-modules'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from './ui/select'

export function ProjectModulePicker({
  canCreate = false,
  compact = false,
  disabled = false,
  modules,
  onChange,
  onCreate,
  organizationManaged = false,
  value,
}: {
  organizationManaged?: boolean
  canCreate?: boolean
  compact?: boolean
  disabled?: boolean
  modules: ProjectModule[]
  onChange: (id: number | null) => void
  onCreate?: (name: string) => Promise<ProjectModule | null>
  value: number | null
}) {
  const [selectOpen, setSelectOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [moduleName, setModuleName] = useState('')
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)
  const selectedModule = modules.find((module) => module.id === value)
  const createModuleValue = '__create_module__'
  const canCreateModule = canCreate && !organizationManaged
  const selectableModules = modules.filter(module => module.selectable)
  const unavailableLabel = selectedModule ? projectModuleUnavailableLabel(selectedModule) : ''

  async function createInlineModule() {
    const nextName = moduleName.trim()
    if (!nextName || !onCreate || creating || !canCreateModule) return
    const existingModule = selectableModules.find((module) => module.name === nextName)
    if (existingModule) {
      onChange(existingModule.id)
      setModuleName('')
      setCreateError('')
      setCreateOpen(false)
      return
    }

    setCreating(true)
    setCreateError('')
    try {
      const createdModule = await onCreate(nextName)
      if (!createdModule) {
        setCreateError('模块创建失败，请重试。')
        return
      }
      onChange(createdModule.id)
      setModuleName('')
      setCreateOpen(false)
    } catch {
      setCreateError('模块创建失败，请重试。')
    } finally {
      setCreating(false)
    }
  }

  function selectModule(nextValue: string) {
    if (nextValue === createModuleValue) {
      setSelectOpen(false)
      setCreateOpen(true)
      setCreateError('')
      return
    }
    onChange(nextValue === 'none' ? null : Number(nextValue))
    setCreateOpen(false)
    setModuleName('')
    setCreateError('')
  }

  return (
    <span className={compact ? 'member-picker compact' : 'member-picker project-module-picker'}>
      <Select
        disabled={disabled}
        open={selectOpen}
        value={value ? String(value) : 'none'}
        onOpenChange={(open) => {
          setSelectOpen(open)
          if (open) {
            setCreateOpen(false)
            setModuleName('')
            setCreateError('')
          }
        }}
        onValueChange={selectModule}
      >
        <SelectTrigger aria-label="待办所属模块">
          <SelectValue placeholder="选择模块">
            {selectedModule ? `${selectedModule.name}${unavailableLabel ? `（${unavailableLabel}）` : ''}` : '无模块'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent footer={organizationManaged ? <div className="project-module-select-footer">由组织统一配置</div> : undefined}>
          <SelectGroup>
            {canCreateModule && onCreate ? (
              <>
                <SelectItem className="project-module-create-option" value={createModuleValue}>
                  <span><Plus size={15} /> 新增模块</span>
                </SelectItem>
                <SelectSeparator />
              </>
            ) : null}
            <SelectItem value="none">无模块</SelectItem>
            {selectableModules.map((module) => (
              <SelectItem key={module.id} value={String(module.id)}>
                {module.name}
              </SelectItem>
            ))}
            {selectedModule && !selectedModule.selectable ? (
              <SelectItem value={String(selectedModule.id)} disabled>{selectedModule.name}（{unavailableLabel}）</SelectItem>
            ) : null}
          </SelectGroup>
        </SelectContent>
      </Select>
      {organizationManaged && selectableModules.length === 0 ? (
        <small className="project-module-availability-hint">组织暂未启用项目模块，可联系组织管理员配置。</small>
      ) : null}
      {selectedModule && !selectedModule.selectable ? (
        <small className="project-module-availability-hint">此待办保留原模块归属；重新选择时仅可使用已启用的模块。</small>
      ) : null}
      {canCreateModule && onCreate && createOpen ? (
        <span className="project-module-inline-create">
          <Input
            autoFocus
            aria-invalid={Boolean(createError)}
            aria-label="新模块名称"
            disabled={creating}
            maxLength={40}
            placeholder="输入模块名称"
            value={moduleName}
            onChange={(event) => {
              setModuleName(event.target.value)
              if (createError) setCreateError('')
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter') {
                event.preventDefault()
                void createInlineModule()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setCreateOpen(false)
                setModuleName('')
                setCreateError('')
              }
            }}
          />
          <Button
            className="project-module-inline-submit"
            type="button"
            disabled={!moduleName.trim() || creating}
            onClick={() => void createInlineModule()}
          >
            <Plus size={14} />
            {creating ? '新增中' : '新增'}
          </Button>
          <Button
            className="project-module-inline-cancel"
            type="button"
            variant="outline"
            aria-label="取消新增模块"
            title="取消新增模块"
            disabled={creating}
            onClick={() => {
              setCreateOpen(false)
              setModuleName('')
              setCreateError('')
            }}
          >
            <X size={14} />
          </Button>
          {createError ? <small role="alert">{createError}</small> : null}
        </span>
      ) : null}
    </span>
  )
}
