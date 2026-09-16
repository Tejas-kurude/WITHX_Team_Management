import { useState } from 'react';
import { FileText, ShieldCheck } from 'lucide-react';
import { PageTitle } from '../components/UI';

type LegalTab = 'TERMS' | 'PRIVACY';

export default function Legal() {
  const [tab, setTab] = useState<LegalTab>('TERMS');

  return (
    <>
      <PageTitle
        title="Legal & Policies"
        subtitle="Terms & Conditions and Privacy Policy for the WITHX Management Platform"
      />

      <div className="w-full">

        {/* TABS */}
        <div className="mb-5 flex w-full flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          <button
            type="button"
            onClick={() => setTab('TERMS')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              tab === 'TERMS'
                ? 'bg-navy text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <FileText size={17} />
            Terms & Conditions
          </button>

          <button
            type="button"
            onClick={() => setTab('PRIVACY')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              tab === 'PRIVACY'
                ? 'bg-navy text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <ShieldCheck size={17} />
            Privacy Policy
          </button>
        </div>

        {tab === 'TERMS' ? <TermsContent /> : <PrivacyContent />}
      </div>
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-slate-200 py-5 last:border-b-0">
      <h2 className="text-lg font-extrabold text-navy">
        {title}
      </h2>

      <div className="mt-2 space-y-2 text-sm leading-6 text-slate-600">
        {children}
      </div>
    </section>
  );
}

function TermsContent() {
  return (
    <div className="card w-full p-5 md:p-7">

      <div className="mb-2 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange/10 text-orange">
          <FileText size={22} />
        </div>

        <div>
          <h1 className="text-xl font-extrabold text-navy">
            Terms & Conditions
          </h1>

          <p className="text-xs muted">
            Effective date: 14 September 2026
          </p>
        </div>
      </div>

      <Section title="1. Purpose of the Platform">
        <p>
          The WITHX Management Platform is an internal workplace
          management system used to manage employees, interns,
          attendance, tasks, daily reports, leave, work hours,
          performance, notifications and related operational records.
        </p>
      </Section>

      <Section title="2. Authorized Access">
        <p>
          Access is limited to authorized users of WITHX Innovations
          Private Limited. Users must use only the account assigned to
          them and must not share passwords, access tokens or other
          login credentials.
        </p>
      </Section>

      <Section title="3. User Responsibilities">
        <p>
          Users are responsible for providing accurate information,
          recording attendance truthfully, submitting genuine work
          updates and using the platform only for legitimate company
          activities.
        </p>

        <p>
          Users must not attempt to access another user's account,
          bypass role permissions, alter records without authorization,
          upload malicious content or interfere with the availability
          or security of the platform.
        </p>
      </Section>

      <Section title="4. Attendance and Work Records">
        <p>
          Attendance, check-in/check-out, work-hour and
          location-related information may be recorded where those
          features are enabled. Users must not intentionally submit
          false attendance or location information.
        </p>
      </Section>

      <Section title="5. Tasks, Reports and Reviews">
        <p>
          Task submissions, proof of work, daily reports, review
          decisions and comments may be retained as part of the
          company's operational records. Review permissions depend on
          the user's assigned role and reporting hierarchy.
        </p>
      </Section>

      <Section title="6. Account Security">
        <p>
          Users must keep their credentials confidential and should
          immediately report suspected unauthorized access, credential
          exposure or unusual activity to an administrator.
        </p>
      </Section>

      <Section title="7. Administrative Actions">
        <p>
          Authorized administrators may create, update, deactivate or
          remove accounts and operational records as necessary for
          legitimate business, security and compliance purposes,
          subject to the permissions built into the platform.
        </p>
      </Section>

      <Section title="8. Availability and Changes">
        <p>
          The platform may be updated, temporarily unavailable or
          modified for maintenance, security or business requirements.
          Features and access permissions may change over time.
        </p>
      </Section>

      <Section title="9. Acceptance">
        <p>
          By accessing and using the WITHX Management Platform, the
          user agrees to follow these terms and applicable company
          policies.
        </p>
      </Section>

      <Section title="10. Contact">
        <p>
          Questions regarding these terms should be directed to the
          authorized WITHX administrator or company management.
        </p>
      </Section>

    </div>
  );
}

function PrivacyContent() {
  return (
    <div className="card w-full p-5 md:p-7">

      <div className="mb-2 flex items-center gap-3">

        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
          <ShieldCheck size={22} />
        </div>

        <div>
          <h1 className="text-xl font-extrabold text-navy">
            Privacy Policy
          </h1>

          <p className="text-xs muted">
            Effective date: 14 September 2026
          </p>
        </div>

      </div>

      <Section title="1. Information We Process">
        <p>
          The platform may process employee or intern information such
          as name, employee ID, email address, phone number, department,
          role, reporting hierarchy, joining details, profile
          information and account status.
        </p>
      </Section>

      <Section title="2. Workplace and Activity Data">
        <p>
          The platform may store attendance records, check-in and
          check-out times, work hours, tasks, task proof, daily reports,
          leave requests, performance information, notifications and
          system activity logs.
        </p>
      </Section>

      <Section title="3. Location Information">
        <p>
          When attendance verification features require location, the
          platform may process location information provided by the
          user's device for attendance verification and related
          workplace purposes.
        </p>
      </Section>

      <Section title="4. How Information Is Used">
        <p>
          Information is used for workforce administration, attendance
          management, task coordination, reporting, performance
          tracking, security, troubleshooting, audit records and other
          legitimate internal business operations.
        </p>
      </Section>

      <Section title="5. Access to Information">
        <p>
          Access is controlled according to user roles such as
          Employee, Team Lead, Admin and Super Admin. Users should only
          be able to view or manage information permitted by their
          assigned role and reporting scope.
        </p>
      </Section>

      <Section title="6. Data Security">
        <p>
          Reasonable technical and organizational safeguards should be
          used to protect stored information, including authentication,
          role-based authorization and secure handling of credentials.
          Users also share responsibility for protecting their login
          credentials.
        </p>
      </Section>

      <Section title="7. Data Retention">
        <p>
          Records may be retained for as long as reasonably required
          for employment, operational, security, audit or legal
          purposes. Retention periods may vary depending on the type of
          record and company requirements.
        </p>
      </Section>

      <Section title="8. Data Correction">
        <p>
          Users should contact an authorized administrator if profile
          or employment information is inaccurate and requires
          correction. Certain records may be editable only by users
          with appropriate administrative permissions.
        </p>
      </Section>

      <Section title="9. Policy Updates">
        <p>
          This policy may be updated when the platform, company
          procedures or applicable requirements change. The latest
          version displayed in the platform will apply from its stated
          effective date.
        </p>
      </Section>

      <Section title="10. Contact">
        <p>
          Privacy-related questions or requests should be directed to
          the authorized WITHX administrator or company management.
        </p>
      </Section>

    </div>
  );
}