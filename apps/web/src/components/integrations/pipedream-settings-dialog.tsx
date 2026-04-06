"use client";

import React, { useState } from 'react';
import {
  Settings,
  KeyRound,
  ExternalLink,
  Loader2,
  Check,
  Eye,
  EyeOff,
  Shield,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  usePipedreamCredentialStatus,
  useSavePipedreamCredentials,
  useDeletePipedreamCredentials,
} from '@/hooks/integrations/use-pipedream-credentials';

const FIELDS = [
  { key: 'client_id', label: 'Client ID', placeholder: 'e.g. z8PKS...' },
  { key: 'client_secret', label: 'Client Secret', placeholder: 'e.g. UeZCz...' },
  { key: 'project_id', label: 'Project ID', placeholder: 'e.g. proj_xxxxx' },
] as const;

export function PipedreamSettingsDialog() {
  const { data: status, isLoading } = usePipedreamCredentialStatus();
  const saveCreds = useSavePipedreamCredentials();
  const deleteCreds = useDeletePipedreamCredentials();

  const [open, setOpen] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({
    client_id: '',
    client_secret: '',
    project_id: '',
  });

  const isCustom = status?.configured && status?.source === 'account';
  const canSave = FIELDS.every((f) => values[f.key]?.trim());

  const handleSave = async () => {
    if (!canSave) return;
    await saveCreds.mutateAsync({
      client_id: values.client_id.trim(),
      client_secret: values.client_secret.trim(),
      project_id: values.project_id.trim(),
      environment: 'production',
    });
    setValues({ client_id: '', client_secret: '', project_id: '' });
  };

  const handleDelete = async () => {
    await deleteCreds.mutateAsync();
    setValues({ client_id: '', client_secret: '', project_id: '' });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative"
          title="Pipedream settings"
        >
          <Settings className="h-4 w-4" />
          {isCustom && (
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-background" />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4" />
            Pipedream Credentials
          </DialogTitle>
        </DialogHeader>

        {/* Current status */}
        <div className="rounded-lg border border-border bg-muted/20 p-3 mt-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Current source</span>
            {isCustom ? (
              <Badge variant="default" className="text-[10px] px-1.5 py-0 font-normal bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">
                <Check className="h-2.5 w-2.5 mr-1" />
                Your credentials
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">
                <Shield className="h-2.5 w-2.5 mr-1" />
                Kortix Default
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            {isCustom
              ? 'Using your own Pipedream project. You can update or revert below.'
              : 'Using Kortix\'s default Pipedream project — works out of the box. Add your own below to use a custom project.'}
          </p>
        </div>

        {/* Form */}
        <div className="space-y-3 mt-2">
          <a
            href="https://pipedream.com/settings/apps"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            Get credentials from Pipedream
            <ExternalLink className="h-3 w-3" />
          </a>

          {FIELDS.map((field) => (
            <div key={field.key} className="grid gap-1.5">
              <Label htmlFor={`dlg-${field.key}`} className="text-xs font-medium text-muted-foreground">
                {field.label}
              </Label>
              <Input
                id={`dlg-${field.key}`}
                type={showSecrets ? 'text' : 'password'}
                placeholder={isCustom ? '••••••••  (keep existing)' : field.placeholder}
                value={values[field.key]}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                className="h-9 text-xs font-mono"
              />
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 mt-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!canSave || saveCreds.isPending}
            className="h-8 px-4 text-xs"
          >
            {saveCreds.isPending ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving...</>
            ) : isCustom ? 'Update' : 'Save'}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSecrets(!showSecrets)}
            className="h-8 px-2 text-xs text-muted-foreground"
          >
            {showSecrets ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>

          {isCustom && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={deleteCreds.isPending}
              className="h-8 px-3 text-xs text-destructive hover:text-destructive ml-auto"
            >
              {deleteCreds.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 mr-1" />
              )}
              Revert to defaults
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
