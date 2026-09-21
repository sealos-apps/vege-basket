import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../index.css'
import '../../App.css'
import '../../components/test-workbench.css'
import { TestPlanPrototype } from './prototype'
import { PrototypeStore } from './mock-api'
import { installPrototypeTransport } from './transport'
import './prototype.css'

try {
  document.documentElement.classList.toggle('dark', localStorage.getItem('veges.theme') !== 'light')
} catch {
  document.documentElement.classList.add('dark')
}

const store = new PrototypeStore()
installPrototypeTransport(store)
localStorage.setItem('veges.testWorkbench.viewState.v1.900001', JSON.stringify({ tab: 'plans', spaceId: 1, selectedPlanId: 24 }))

createRoot(document.getElementById('root')!).render(<StrictMode><TestPlanPrototype store={store} /></StrictMode>)
