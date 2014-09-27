(function(){

  describe('sampleDomainApp', function () {
    var scope,
      controller,
      AppGenerate,
      AppFeatures;

    beforeEach(function () {
      module('sampleDomainApp');
    });

    describe('FeaturesCtrl', function () {

      beforeEach(inject(function ($rootScope, $controller) {
        scope = $rootScope.$new();

        AppGenerate = jasmine.createSpyObj('AppGenerate', ['generate', 'compile']);

        // Mock out loading of data from AppFeatures.loadFeatures
        AppFeatures = {
          loadFeatures: function(){
            var success = function (process) {
              process({data: {}});
            };
            return { success: success }
          }
        };

        controller = $controller('FeaturesCtrl', {
          '$scope': scope,
          'AppGenerate': AppGenerate,
          'AppFeatures': AppFeatures
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
