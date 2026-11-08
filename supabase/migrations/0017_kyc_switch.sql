-- Identity checks cost money per check, so they stay off until this is set to 'true'.
insert into app_config(key,value) values('kyc_enabled','false') on conflict(key) do nothing;