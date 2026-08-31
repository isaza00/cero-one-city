import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../store/auth";

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <>
      <nav className="topnav">
        <NavLink to="/" className="brand">CERO ONE CITY</NavLink>
        <NavLink to="/matches">Live</NavLink>
        <NavLink to="/leaderboard">Ranking</NavLink>
        {user && <NavLink to="/agents">My agents</NavLink>}
        {user && <NavLink to="/custom">Custom</NavLink>}
        {user?.role === "admin" && <NavLink to="/admin">Admin</NavLink>}
        <span className="spacer" />
        {user ? (
          <>
            <NavLink to="/settings">{user.display_name}</NavLink>
            <a href="#" onClick={(e) => { e.preventDefault(); logout(); navigate("/"); }}>
              Log out
            </a>
          </>
        ) : (
          <>
            <NavLink to="/login">Log in</NavLink>
            <NavLink to="/register">Sign up</NavLink>
          </>
        )}
      </nav>
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}
