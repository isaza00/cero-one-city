import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { musicPlaying, startMusic, stopMusic } from "../audio/music";
import { useAuth } from "../store/auth";

function MusicToggle() {
  const [on, setOn] = useState(musicPlaying());
  const toggle = async () => {
    if (on) stopMusic(); else await startMusic();
    setOn(!on);
  };
  return (
    <button type="button" className="music-btn" onClick={toggle}
            title={on ? "Mute soundtrack" : "Play soundtrack"}>
      {on ? "♫ sound on" : "♫ sound off"}
    </button>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <>
      <nav className="topnav">
        <NavLink to="/" className="brand">CERO ONE CITY</NavLink>
        <NavLink to="/matches">Live</NavLink>
        <NavLink to="/leaderboard">Ranking</NavLink>
        {/* Always visible - they just bounce to /login when logged out. */}
        <NavLink to="/agents">My agents</NavLink>
        <NavLink to="/custom">Private match</NavLink>
        {user?.role === "admin" && <NavLink to="/admin">Admin</NavLink>}
        <span className="spacer" />
        <MusicToggle />
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
