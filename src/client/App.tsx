import { Routes, Route } from 'react-router-dom'
import { Shell } from './components/layout/Shell'
import DashboardPage from './pages/DashboardPage'
import CronjobsPage from './pages/CronjobsPage'
import UsagePage from './pages/UsagePage'

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/crons" element={<CronjobsPage />} />
        <Route path="/usage" element={<UsagePage />} />
      </Routes>
    </Shell>
  )
}
