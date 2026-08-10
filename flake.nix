{
  description = "Carnap Server development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    systems.url = "github:nix-systems/default";
  };

  outputs =
    {
      self,
      nixpkgs,
      systems,
    }:
    let
      eachSystem = nixpkgs.lib.genAttrs (import systems);
    in
    {
      devShells = eachSystem (
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
          };
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              bashInteractive
              bun
              nodejs_22
              wrangler

              sqlite
              jq
              curl
              openssl

              git
              gh
              just
              ripgrep
              fd

              nil
              nixfmt
              typescript-language-server
              vscode-langservers-extracted
            ];

            shellHook = ''
              export CARNAP_ENV="local"
              export NODE_ENV="development"
            '';
          };
        }
      );
    };
}
