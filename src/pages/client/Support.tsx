import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { useBranding } from '../../context/BrandingContext';
import { useClientAuth } from '../../context/ClientAuthContext';
import { Card, CardHeader } from '../../components/ui/Card';
import { PageHeader } from '../../components/shared';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { IconMail, IconPhone, IconPin, IconSupport } from '../../components/ui/Icons';

export function Support() {
  const { branding } = useBranding();
  const { client } = useClientAuth();
  const [fullName, setFullName] = useState(client?.fullName || '');
  const [email, setEmail] = useState(client?.email || '');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/api/client/auth/access-reset-request', { fullName, email });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit the request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
      <PageHeader title="Support" description="Get help with your payments or request a new access code." />

      <Card>
        <CardHeader title="Contact us" description="Our team is here to help with invoices, payments and access issues." />
        <ul className="space-y-3 text-sm">
          {branding?.supportEmail && (
            <li className="flex items-center gap-3 text-slate-600">
              <IconMail className="h-5 w-5 text-brand-500" />
              <a href={`mailto:${branding.supportEmail}`} className="link font-medium">
                {branding.supportEmail}
              </a>
            </li>
          )}
          {branding?.supportPhone && (
            <li className="flex items-center gap-3 text-slate-600">
              <IconPhone className="h-5 w-5 text-brand-500" />
              <a href={`tel:${branding.supportPhone}`} className="link font-medium">
                {branding.supportPhone}
              </a>
            </li>
          )}
          {branding?.whatsappNumber && (
            <li className="flex items-center gap-3 text-slate-600">
              <IconPhone className="h-5 w-5 text-green-500" />
              <a
                href={`https://wa.me/${branding.whatsappNumber.replace(/[^\d]/g, '')}`}
                target="_blank"
                rel="noreferrer"
                className="link font-medium"
              >
                WhatsApp {branding.whatsappNumber}
              </a>
            </li>
          )}
          {branding?.officeAddress && (
            <li className="flex items-start gap-3 text-slate-600">
              <IconPin className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
              <span>{branding.officeAddress}</span>
            </li>
          )}
          {!branding?.supportEmail && !branding?.supportPhone && !branding?.whatsappNumber && !branding?.officeAddress && (
            <li className="text-slate-400">Support contact details have not been configured yet.</li>
          )}
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="Request a new access code"
          description="If you have lost your access code, submit a request and our team will contact you."
        />
        {sent ? (
          <Alert tone="success">Request received. If the details match an account, our team will contact you with a new access code.</Alert>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            {error && <Alert tone="error">{error}</Alert>}
            <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            <Input label="Email address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Button type="submit" loading={submitting} loadingText="Sending request…">
              <IconSupport className="h-4 w-4" />
              Send request
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
