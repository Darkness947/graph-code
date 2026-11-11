import { Outlet, Route, Routes } from 'react-router-dom';
import AppToast from './components/AppToast.jsx';
import NavBar from './components/NavBar.jsx';
import ViewportNotice from './components/ViewportNotice.jsx';
import ProtectedRoute from './features/auth/ProtectedRoute.jsx';
import About from './pages/About.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ErrorPage from './pages/ErrorPage.jsx';
import Landing from './pages/Landing.jsx';
import NotFound from './pages/NotFound.jsx';
import Privacy from './pages/Privacy.jsx';
import Workspace from './pages/Workspace.jsx';

/** The frame every page shares: top bar, desktop notice, toast and the page itself. */
function Layout() {
  return (
    <div className="app-frame">
      <NavBar />
      <ViewportNotice />
      <main className="app-main">
        <Outlet />
      </main>
      <AppToast />
    </div>
  );
}

/** The route table from spec 8.2. Must be rendered inside a router. */
export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/about" element={<About />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/error" element={<ErrorPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/repos/:id" element={<Workspace />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
