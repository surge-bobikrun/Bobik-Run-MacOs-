-- Дополнительное ограничение доступа к промокодам.
-- Вызывать redeem_game_code могут только авторизованные аккаунты.
revoke execute on function public.redeem_game_code(text) from public, anon;
grant execute on function public.redeem_game_code(text) to authenticated;

-- Роли и история активаций не должны быть доступны клиентским ролям.
revoke all on public.promo_redemptions, public.user_roles from public, anon, authenticated;
