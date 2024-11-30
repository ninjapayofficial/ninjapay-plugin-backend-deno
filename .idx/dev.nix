# To learn more about how to use Nix to configure your environment
# see: https://developers.google.com/idx/guides/customize-idx-env
{ pkgs, ... }: {
  # Which nixpkgs channel to use.
  channel = "unstable"; # or "unstable" or stable-24.05
  # Use https://search.nixos.org/packages to find packages
  packages = [
    pkgs.deno
  ];
  # Sets environment variables in the workspace 
  env = {};
  idx = {
    # Search for the extensions you want on https://open-vsx.org/ and use "publisher.id"
    extensions = [
      "denoland.vscode-deno"
    ];
    workspace = {
      # Runs when a workspace is first created with this `dev.nix` file
      onCreate = {
        npm-install = "npm ci --no-audit --prefer-offline --no-progress --timing";
      };
      # Runs when a workspace is (re)started
      onStart= {
        run-server = "npm run dev";
      };
    };
  };
}