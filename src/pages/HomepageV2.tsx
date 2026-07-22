import { useRef, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  FileText,
  Menu,
  MessageSquare,
  Search,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { Link } from 'react-router-dom';
import './HomepageV2.css';

gsap.registerPlugin(useGSAP, ScrollTrigger);

const navigation = ['Platform', 'School life', 'Intelligence'];

const capabilities = [
  { icon: CalendarDays, title: 'The school day, in view', text: 'Attendance, cover, events, and the next important action stay in one shared rhythm.' },
  { icon: UsersRound, title: 'Every person connected', text: 'Leadership, staff, students, and families get a clear view of what matters to them.' },
  { icon: Sparkles, title: 'AI with a practical job', text: 'Plan timetables, prepare documents, and make communication easier to review before it goes out.' },
];

function BrandMark() {
  return (
    <span className="ks-brand-mark" aria-hidden="true">
      <img src="/brand/kryin-mark-light.png" alt="" />
    </span>
  );
}

function WorkspacePreview() {
  return (
    <div className="ks-workspace" aria-label="Illustrative KryinSchool workspace">
      <aside className="ks-workspace-sidebar">
        <div className="ks-workspace-sidebar-brand"><BrandMark /></div>
        <div className="ks-workspace-sidebar-links" aria-hidden="true">
          <span className="is-active"><CalendarDays size={16} /> Overview</span>
          <span><UsersRound size={16} /> People</span>
          <span><FileText size={16} /> Learning</span>
          <span><MessageSquare size={16} /> Messages</span>
        </div>
        <span className="ks-workspace-avatar">PS</span>
      </aside>
      <div className="ks-workspace-main">
        <header className="ks-workspace-topbar">
          <div className="ks-workspace-search"><Search size={15} /><span>Search KryinSchool</span><kbd>/</kbd></div>
          <span className="ks-workspace-date">Wednesday, 18 June</span>
        </header>
        <div className="ks-workspace-content">
          <div className="ks-workspace-welcome">
            <div>
              <p>Northbridge Academy</p>
              <h2>Good morning, Priya.</h2>
            </div>
            <button type="button"><Sparkles size={15} /> Ask Kryin</button>
          </div>
          <div className="ks-workspace-overview">
            <article className="ks-overview-wide">
              <div className="ks-panel-title"><span>Today</span><button type="button">View calendar <ChevronRight size={14} /></button></div>
              <div className="ks-timeline">
                <div><time>08:30</time><span className="ks-timeline-dot" /><p><strong>Year 9 science</strong><small>Lab 2 · Ms Shah</small></p></div>
                <div><time>10:15</time><span className="ks-timeline-dot" /><p><strong>Family update</strong><small>Attendance reminder · 24 families</small></p></div>
                <div><time>13:00</time><span className="ks-timeline-dot muted" /><p><strong>Staff briefing</strong><small>Library · Leadership team</small></p></div>
              </div>
            </article>
            <article className="ks-overview-note">
              <span className="ks-ai-icon"><Sparkles size={15} /></span>
              <p>Planning assistant</p>
              <strong>Two timetable conflicts are ready for review.</strong>
              <button type="button">Review suggestions <ArrowRight size={14} /></button>
            </article>
          </div>
          <div className="ks-workspace-footer-row">
            <span><i /> Attendance is up to date</span>
            <span>12:42 PM</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomepageV2() {
  const pageRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add({ desktop: '(min-width: 861px)', reduce: '(prefers-reduced-motion: reduce)' }, (context) => {
      const { desktop, reduce } = context.conditions as { desktop: boolean; reduce: boolean };
      if (reduce) return undefined;

      gsap.timeline({ defaults: { ease: 'power3.out' } })
        .from('.ks-header', { y: -18, autoAlpha: 0, duration: 0.5 })
        .from('.ks-hero-copy > *', { y: 30, autoAlpha: 0, duration: 0.72, stagger: 0.09 }, '-=0.18')
        .from('.ks-workspace', { y: 54, autoAlpha: 0, scale: 0.975, duration: 0.95 }, '-=0.42');

      gsap.to('.ks-workspace', {
        yPercent: desktop ? -5 : 0,
        ease: 'none',
        scrollTrigger: { trigger: '.ks-hero', start: 'top top', end: 'bottom top', scrub: 0.9 },
      });

      gsap.from('.ks-capability', {
        y: 34,
        autoAlpha: 0,
        duration: 0.7,
        stagger: 0.1,
        scrollTrigger: { trigger: '.ks-capabilities', start: 'top 76%' },
      });

      gsap.from('.ks-school-life-copy, .ks-school-life-quote', {
        y: 42,
        autoAlpha: 0,
        duration: 0.8,
        stagger: 0.12,
        scrollTrigger: { trigger: '.ks-school-life', start: 'top 74%' },
      });
      return undefined;
    });
    return () => media.revert();
  }, { scope: pageRef });

  return (
    <div ref={pageRef} className="ks-page">
      <header className="ks-header">
        <nav className="ks-nav" aria-label="Primary navigation">
          <a className="ks-brand" href="#top" aria-label="KryinSchool home"><BrandMark /><span>KryinSchool</span></a>
          <div className="ks-nav-links">
            {navigation.map((item, index) => <a key={item} href={index === 0 ? '#platform' : index === 1 ? '#school-life' : '#intelligence'}>{item}</a>)}
          </div>
          <div className="ks-nav-actions"><Link to="/dashboard">Sign in</Link><a className="ks-button ks-button-primary" href="#demo">Book a demo <ArrowRight size={15} /></a></div>
          <button className="ks-menu-button" type="button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-controls="ks-mobile-menu">
            <span className="sr-only">Toggle navigation</span>{menuOpen ? <X /> : <Menu />}
          </button>
        </nav>
        <div id="ks-mobile-menu" className={`ks-mobile-menu ${menuOpen ? 'is-open' : ''}`}>
          <a href="#platform" onClick={() => setMenuOpen(false)}>Platform</a><a href="#school-life" onClick={() => setMenuOpen(false)}>School life</a><a href="#intelligence" onClick={() => setMenuOpen(false)}>Intelligence</a><Link to="/dashboard" onClick={() => setMenuOpen(false)}>Sign in</Link><a href="#demo" onClick={() => setMenuOpen(false)}>Book a demo</a>
        </div>
      </header>

      <main id="top">
        <section className="ks-hero" aria-labelledby="ks-title">
          <div className="ks-hero-copy">
            <p className="ks-kicker">The complete school system</p>
            <h1 id="ks-title">The school day, finally <em>in one place.</em></h1>
            <p>Everything your school needs to run with clarity, from the front desk to the classroom.</p>
            <div className="ks-hero-actions"><a className="ks-button ks-button-primary" href="#demo">Book a demo <ArrowRight size={17} /></a><a className="ks-button ks-button-quiet" href="#platform">Explore the platform</a></div>
          </div>
          <div className="ks-hero-product"><WorkspacePreview /></div>
        </section>

        <section id="platform" className="ks-capabilities" aria-label="KryinSchool capabilities">
          {capabilities.map(({ icon: Icon, title, text }) => <article className="ks-capability" key={title}><Icon size={22} strokeWidth={1.7} /><h2>{title}</h2><p>{text}</p><a href="#demo">Learn more <ArrowRight size={15} /></a></article>)}
        </section>

        <section id="school-life" className="ks-school-life" aria-labelledby="ks-school-life-title">
          <div className="ks-school-life-copy"><p className="ks-kicker">Built around real school life</p><h2 id="ks-school-life-title">A clearer system for the people who keep a school moving.</h2><p>One secure place for attendance, learning, communication, wellbeing, finance, and the everyday work that connects them.</p><a className="ks-inline-link" href="#demo">See what KryinSchool can connect <ArrowRight size={16} /></a></div>
          <blockquote className="ks-school-life-quote"><span>“</span><p>Less chasing, less duplication, and a better view of the decisions that need our attention.</p><footer>For leaders, staff, families, and students.</footer></blockquote>
        </section>

        <section id="intelligence" className="ks-intelligence" aria-labelledby="ks-intelligence-title">
          <div><p className="ks-kicker">Kryin intelligence</p><h2 id="ks-intelligence-title">Useful help, with people still in control.</h2></div>
          <div className="ks-intelligence-list"><article><span>Timetables</span><p>Build a workable first draft around rooms, classes, and teaching time.</p></article><article><span>Reports</span><p>Prepare documents from approved school data, ready for a human review.</p></article><article><span>Communication</span><p>Draft the right update for the right families without losing the context.</p></article></div>
        </section>

        <section id="demo" className="ks-demo" aria-labelledby="ks-demo-title"><div><p className="ks-kicker">See it in context</p><h2 id="ks-demo-title">Make the next school day easier to run.</h2></div><a className="ks-button ks-button-primary" href="mailto:?subject=KryinSchool%20demo%20request">Book a demo <ArrowRight size={17} /></a></section>
      </main>

      <footer className="ks-footer"><a className="ks-brand" href="#top"><BrandMark /><span>KryinSchool</span></a><p>One connected system for school life.</p><Link to="/">View current homepage</Link></footer>
    </div>
  );
}
