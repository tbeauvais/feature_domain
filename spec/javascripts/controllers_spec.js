(function(){

  describe('sampleDomainApp', function () {
    var scope,
      controller,
      AppGenerate,
      $mockLocationService = {};

    beforeEach(function () {
      module('sampleDomainApp');
    });

    describe('FeaturesCtrl', function () {

      beforeEach(inject(function ($rootScope, $controller) {
        scope = $rootScope.$new();

        AppGenerate = {
          generate: function(){},
          compile: function(){}
        };

        spyOn(AppGenerate, 'generate');
        spyOn(AppGenerate, 'compile');

        controller = $controller('FeaturesCtrl', {
          '$scope': scope,
          'AppGenerate': AppGenerate
        });

      }));

      it('sets sortableOptions', function () {
        expect(scope.sortableOptions).not.toEqual(null);
      });

      it('calls generate', function () {
        expect(AppGenerate.generate).toHaveBeenCalled();
      });

      it('calls compile', function () {
        expect(AppGenerate.compile).toHaveBeenCalled();
      });

    });

  });

})();
